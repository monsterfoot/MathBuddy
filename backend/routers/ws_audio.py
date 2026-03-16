"""WebSocket endpoint for real-time voice coaching via Gemini Live API + ADK."""

import asyncio
import logging
import time
import uuid

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from google.adk.agents import LiveRequestQueue
from google.adk.agents.run_config import RunConfig, StreamingMode
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

from config import (
    AUDIO_INPUT_SAMPLE_RATE,
    COACHING_FAREWELL_KEYWORD_DEFAULT,
    COACHING_FAREWELL_KEYWORDS,
    COACHING_INACTIVITY_TIMEOUT_S,
    COACHING_MAX_SESSION_S,
    COACHING_MIN_TURNS_FOR_WRONG,
    CONCEPT_TAG_DEFAULT,
    GEMINI_LIVE_MODEL,
)
from math_coach_agent.sub_agents.coaching_agent import (
    create_coaching_agent,
    format_coaching_instruction,
)
from services import firestore_service as db
from services.auth_service import get_current_user
from services.locale_service import DEFAULT_LOCALE, SUPPORTED_LOCALES

router = APIRouter()
logger = logging.getLogger(__name__)

# --- Short-lived coaching tickets (replaces token-in-URL) ---
COACHING_TICKET_TTL_S = 30  # tickets valid for 30 seconds
_coaching_tickets: dict[str, dict] = {}  # ticket_id → {uid, created_at}


def _cleanup_expired_tickets() -> None:
    """Remove expired tickets to prevent memory buildup."""
    now = time.time()
    expired = [k for k, v in _coaching_tickets.items() if now - v["created_at"] > COACHING_TICKET_TTL_S * 2]
    for k in expired:
        del _coaching_tickets[k]


@router.post("/ws/coach/ticket")
async def create_coaching_ticket(user: dict = Depends(get_current_user)):
    """Issue a short-lived ticket for WebSocket authentication.

    The client exchanges a Bearer token (via HTTP header) for a single-use
    ticket, then passes only the ticket in the WebSocket URL — keeping the
    long-lived Firebase token out of query strings and logs.
    """
    _cleanup_expired_tickets()
    ticket_id = uuid.uuid4().hex
    _coaching_tickets[ticket_id] = {"uid": user["uid"], "created_at": time.time()}
    return {"ticket": ticket_id}

# Shared session service (singleton per process)
_session_service = InMemorySessionService()

# Voice config for the coaching agent
_run_config = RunConfig(
    response_modalities=[types.Modality.AUDIO],
    streaming_mode=StreamingMode.BIDI,
    speech_config=types.SpeechConfig(
        voice_config=types.VoiceConfig(
            prebuilt_voice_config=types.PrebuiltVoiceConfig(
                voice_name="Despina",
            )
        )
    ),
)

# Demo problem contexts for Phase 1 testing (before scan wizard is built)
DEMO_CONTEXTS = {
    "demo_1": {
        "page": 5,
        "number": 3,
        "student_answer": "-3",
        "correct_answer": "-13",
        "solution_steps": [
            "Calculate (-5) + (-8)",
            "Since both have the same sign (negative), add their absolute values: 5 + 8 = 13",
            "Apply the common sign (negative): -13",
        ],
        "pitfalls": [
            "Subtracting absolute values instead of adding when signs are the same",
            "Incorrectly writing the sign as positive",
        ],
        "concept_tag": "CALC",
    },
    "demo_2": {
        "page": 7,
        "number": 12,
        "student_answer": "2",
        "correct_answer": "-2",
        "solution_steps": [
            "Calculate (-9) + 7",
            "Since the signs differ, find the difference of absolute values: 9 - 7 = 2",
            "Take the sign of the number with the larger absolute value: -9 is larger, so -2",
        ],
        "pitfalls": [
            "Forgetting the sign in the result",
            "Taking the sign of the smaller absolute value instead of the larger",
        ],
        "concept_tag": "CALC",
    },
    "demo_3": {
        "page": 10,
        "number": 5,
        "student_answer": "3/4",
        "correct_answer": "-3/4",
        "solution_steps": [
            "Calculate (-3/8) / (1/2)",
            "Convert division to multiplication by the reciprocal: (-3/8) x (2/1)",
            "Multiply numerators and denominators: (-3x2)/(8x1) = -6/8",
            "Reduce: -6/8 = -3/4",
        ],
        "pitfalls": [
            "Dividing directly without taking the reciprocal",
            "Forgetting the negative sign",
        ],
        "concept_tag": "CALC",
    },
}


async def _load_problem_context(attempt_id: str) -> dict:
    """Load problem context from Firestore or demo data."""
    # Try Firestore first
    if attempt_id and not attempt_id.startswith("demo"):
        attempt = await db.get_attempt(attempt_id)
        if attempt:
            answer_key = await db.get_answer_key(
                attempt["workbook_id"], attempt["page"], attempt["number"]
            )
            if answer_key:
                return {
                    "page": attempt["page"],
                    "number": attempt["number"],
                    "student_answer": attempt.get("student_answer", "unknown"),
                    "correct_answer": answer_key["final_answer"],
                    "solution_steps": answer_key.get("solution_steps", []),
                    "pitfalls": answer_key.get("pitfalls", []),
                    "concept_tag": answer_key.get("concept_tag", CONCEPT_TAG_DEFAULT),
                    "error_tag": attempt.get("error_tag"),
                    "is_correct": attempt.get("is_correct", False),
                    "feedback": attempt.get("feedback", ""),
                    "work_analysis": attempt.get("work_analysis", ""),
                    "problem_description": attempt.get("problem_description", ""),
                }

            # Attempt exists but answer_key not found (e.g. verify/review
            # attempts where workbook_id="variant" or page/number=0).
            # Use attempt data directly instead of falling back to demo.
            logger.info(
                "No answer_key for attempt %s (workbook=%s page=%s number=%s) "
                "— using attempt data directly",
                attempt_id, attempt.get("workbook_id"),
                attempt.get("page"), attempt.get("number"),
            )
            return {
                "page": attempt.get("page", 0),
                "number": attempt.get("number", 0),
                "student_answer": attempt.get("student_answer", "unknown"),
                "correct_answer": attempt.get("correct_answer", "?"),
                "solution_steps": [],
                "pitfalls": [],
                "concept_tag": attempt.get("concept_tag", CONCEPT_TAG_DEFAULT),
                "error_tag": attempt.get("error_tag"),
                "is_correct": attempt.get("is_correct", False),
                "feedback": attempt.get("feedback", ""),
                "work_analysis": attempt.get("work_analysis", ""),
                "problem_description": attempt.get("problem_description", ""),
            }

    # Fallback to demo context
    if attempt_id in DEMO_CONTEXTS:
        return DEMO_CONTEXTS[attempt_id]

    # Default demo
    return DEMO_CONTEXTS["demo_1"]


@router.websocket("/ws/coach")
async def coach_websocket(
    websocket: WebSocket,
    attempt_id: str = "demo_1",
    retry: str = "false",
    ticket: str = "",
    variant_text: str = "",
    variant_answer: str = "",
    variant_student_answer: str = "",
    locale: str = DEFAULT_LOCALE,
):
    """Bidirectional audio proxy: Browser <-> Backend <-> Gemini Live API.

    Audio format:
    - Client -> Server: 16-bit PCM, 16kHz, mono (binary WebSocket frames)
    - Server -> Client: 16-bit PCM, 24kHz, mono (binary WebSocket frames)
    - Server -> Client: JSON for transcripts and control messages
    """
    is_retry = retry.lower() == "true"
    if locale not in SUPPORTED_LOCALES:
        locale = DEFAULT_LOCALE
    farewell_keyword = COACHING_FAREWELL_KEYWORDS.get(locale, COACHING_FAREWELL_KEYWORD_DEFAULT)

    # Validate short-lived coaching ticket (issued via POST /ws/coach/ticket)
    ticket_data = _coaching_tickets.pop(ticket, None) if ticket else None
    if not ticket_data:
        await websocket.close(code=4001, reason="Invalid or missing ticket")
        return
    if time.time() - ticket_data["created_at"] > COACHING_TICKET_TTL_S:
        await websocket.close(code=4001, reason="Ticket expired")
        return

    student_id = ticket_data["uid"]
    await websocket.accept()

    logger.info(
        "Voice coaching session started: attempt=%s student=%s retry=%s",
        attempt_id,
        student_id,
        is_retry,
    )

    # 1. Load problem context
    context = await _load_problem_context(attempt_id)
    context["is_retry"] = is_retry

    # Inject variant context for retry coaching (after verify fail)
    if is_retry and variant_text:
        context["variant_text"] = variant_text
        context["variant_answer"] = variant_answer
        context["variant_student_answer"] = variant_student_answer

    logger.info(
        "Loaded problem context: page=%s number=%s retry=%s variant=%s "
        "problem_desc=%s work_analysis=%s",
        context["page"], context["number"], is_retry, bool(variant_text),
        bool(context.get("problem_description")),
        bool(context.get("work_analysis")),
    )

    # 2. Format instruction with problem context (avoids ADK state injection issues)
    instruction = format_coaching_instruction(context, locale=locale)
    agent = create_coaching_agent(instruction)
    logger.info(
        "Coaching instruction length=%d, problem_desc='%s'",
        len(instruction),
        (context.get("problem_description") or "none")[:80],
    )

    # 3. Create per-session runner
    runner = Runner(
        app_name="math_coach",
        agent=agent,
        session_service=_session_service,
    )

    # 4. Create ADK session
    session_id = uuid.uuid4().hex
    session = await _session_service.create_session(
        app_name="math_coach",
        user_id=student_id,
        session_id=session_id,
    )

    # 5. Create LiveRequestQueue
    live_request_queue = LiveRequestQueue()

    # Notify client that session is ready
    await websocket.send_json({
        "type": "status",
        "message": "connected",
        "session_id": session_id,
    })

    async def upstream():
        """Receive audio from client WebSocket, forward to ADK queue."""
        try:
            while True:
                data = await asyncio.wait_for(
                    websocket.receive(),
                    timeout=COACHING_INACTIVITY_TIMEOUT_S,
                )

                if data.get("type") == "websocket.disconnect":
                    break

                if "bytes" in data and data["bytes"]:
                    # Binary frame = raw PCM audio
                    audio_blob = types.Blob(
                        data=data["bytes"],
                        mime_type=f"audio/pcm;rate={AUDIO_INPUT_SAMPLE_RATE}",
                    )
                    live_request_queue.send_realtime(audio_blob)

                elif "text" in data and data["text"]:
                    import json
                    try:
                        msg = json.loads(data["text"])
                        if msg.get("type") == "ping":
                            pass  # keepalive — do not forward to Gemini
                        elif msg.get("type") == "text":
                            # Text message from client
                            live_request_queue.send_content(
                                types.Content(
                                    role="user",
                                    parts=[types.Part(text=msg["text"])],
                                )
                            )
                        elif msg.get("type") == "end":
                            break
                    except (json.JSONDecodeError, KeyError):
                        pass

        except asyncio.TimeoutError:
            logger.warning(
                "Upstream inactivity timeout (%ds) — closing session",
                COACHING_INACTIVITY_TIMEOUT_S,
            )
        except WebSocketDisconnect:
            logger.info("Client disconnected")
        except Exception:
            logger.exception("Error in upstream")
        finally:
            live_request_queue.close()

    async def downstream():
        """Receive events from ADK run_live, forward audio/text to client."""
        turn_count = 0
        coaching_completed = False

        try:
            async for event in runner.run_live(
                user_id=student_id,
                session_id=session_id,
                live_request_queue=live_request_queue,
                run_config=_run_config,
            ):
                # Send audio chunks to client
                if event.content and event.content.parts:
                    for part in event.content.parts:
                        if (
                            part.inline_data
                            and part.inline_data.mime_type
                            and "audio/pcm" in part.inline_data.mime_type
                        ):
                            await websocket.send_bytes(part.inline_data.data)

                # Send output transcription (partial + finished for streaming display)
                if event.output_transcription and event.output_transcription.text:
                    await websocket.send_json({
                        "type": "transcript",
                        "role": "agent",
                        "text": event.output_transcription.text,
                        "finished": bool(event.output_transcription.finished),
                    })

                    # Detect farewell keyword in finished transcriptions
                    if (
                        event.output_transcription.finished
                        and farewell_keyword in event.output_transcription.text
                        and not coaching_completed
                    ):
                        coaching_completed = True
                        logger.info(
                            "Coaching farewell detected at turn %d", turn_count,
                        )
                        await websocket.send_json({
                            "type": "coaching_complete",
                            "turn_count": turn_count,
                        })

                # Send input transcription (partial + finished for streaming display)
                if event.input_transcription and event.input_transcription.text:
                    await websocket.send_json({
                        "type": "transcript",
                        "role": "user",
                        "text": event.input_transcription.text,
                        "finished": bool(event.input_transcription.finished),
                    })

                # Signal turn complete with turn count
                if event.turn_complete:
                    turn_count += 1
                    await websocket.send_json({
                        "type": "turn_complete",
                        "turn_count": turn_count,
                    })

                # Handle interruption (echo causing self-interrupt if frequent)
                if event.interrupted:
                    logger.info("Agent interrupted at turn %d", turn_count)
                    await websocket.send_json({"type": "interrupted"})

        except WebSocketDisconnect:
            logger.info("Client disconnected during downstream")
        except Exception as e:
            err_str = str(e)
            # WebSocket 1000 (normal close) is not a real error
            if "1000" in err_str:
                logger.info("Gemini Live session closed normally")
            else:
                logger.error(
                    "Downstream error (turn=%d): %s: %s",
                    turn_count,
                    type(e).__name__,
                    err_str,
                )
        finally:
            # Send coaching_complete on session end if not already sent
            if not coaching_completed:
                try:
                    await websocket.send_json({
                        "type": "coaching_complete",
                        "turn_count": turn_count,
                    })
                except Exception:
                    pass

    try:
        await asyncio.gather(upstream(), downstream())
    except Exception:
        logger.exception("Error in coaching session")
    finally:
        logger.info("Coaching session ended: %s", session_id)
        try:
            await websocket.close()
        except Exception:
            pass

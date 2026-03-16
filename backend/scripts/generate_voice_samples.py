"""
Gemini TTS 전체 목소리 샘플 생성 스크립트

사용법:
  cd backend
  python scripts/generate_voice_samples.py

출력: backend/voice_samples/ 디렉토리에 WAV 파일 생성
"""

import os
import sys
import wave
import asyncio

# load_dotenv must run before google imports
from dotenv import load_dotenv
load_dotenv()

from google import genai
from google.genai import types

# 전체 Gemini TTS 목소리 목록
ALL_VOICES = [
    "Achernar", "Achird", "Algenib", "Algieba", "Alnilam",
    "Aoede", "Autonoe", "Callirrhoe", "Charon", "Despina",
    "Enceladus", "Erinome", "Fenrir", "Gacrux", "Iapetus",
    "Kore", "Laomedeia", "Leda", "Orus", "Puck",
    "Pulcherrima", "Rasalgethi", "Sadachbia", "Sadaltager", "Schedar",
    "Sulafat", "Umbriel", "Vindemiatrix", "Zephyr", "Zubenelgenubi",
]

SAMPLE_TEXT = (
    "안녕하세요! 저는 여러분의 수학 코치입니다. "
    "오늘도 함께 재미있게 수학 공부를 해볼까요? "
    "어려운 문제가 있으면 언제든 물어보세요!"
)

TTS_MODEL = "gemini-2.5-flash-preview-tts"
OUTPUT_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "voice_samples")


def save_wav(filename: str, pcm_data: bytes, channels=1, rate=24000, sample_width=2):
    with wave.open(filename, "wb") as wf:
        wf.setnchannels(channels)
        wf.setsampwidth(sample_width)
        wf.setframerate(rate)
        wf.writeframes(pcm_data)


def generate_sample(client: genai.Client, voice_name: str) -> bytes | None:
    try:
        response = client.models.generate_content(
            model=TTS_MODEL,
            contents=SAMPLE_TEXT,
            config=types.GenerateContentConfig(
                response_modalities=["AUDIO"],
                speech_config=types.SpeechConfig(
                    voice_config=types.VoiceConfig(
                        prebuilt_voice_config=types.PrebuiltVoiceConfig(
                            voice_name=voice_name,
                        )
                    )
                ),
            ),
        )
        return response.candidates[0].content.parts[0].inline_data.data
    except Exception as e:
        print(f"  [ERROR] {voice_name}: {e}")
        return None


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # Vertex AI 설정 확인
    use_vertex = os.getenv("GOOGLE_GENAI_USE_VERTEXAI", "").lower() == "true"
    if use_vertex:
        project = os.getenv("GOOGLE_CLOUD_PROJECT")
        location = os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1")
        print(f"Using Vertex AI (project={project}, location={location})")
        client = genai.Client(vertexai=True, project=project, location=location)
    else:
        api_key = os.getenv("GOOGLE_API_KEY")
        print(f"Using Google AI Studio (API key={'set' if api_key else 'NOT SET'})")
        client = genai.Client()

    print(f"Model: {TTS_MODEL}")
    print(f"Output: {OUTPUT_DIR}")
    print(f"Voices: {len(ALL_VOICES)}개")
    print(f"Sample text: {SAMPLE_TEXT[:40]}...")
    print("-" * 50)

    success = 0
    failed = []

    for i, voice in enumerate(ALL_VOICES, 1):
        print(f"[{i:2d}/{len(ALL_VOICES)}] {voice}...", end=" ", flush=True)
        audio_data = generate_sample(client, voice)

        if audio_data:
            filepath = os.path.join(OUTPUT_DIR, f"{voice.lower()}.wav")
            save_wav(filepath, audio_data)
            duration_sec = len(audio_data) / (24000 * 2)  # 24kHz, 16-bit
            print(f"OK ({duration_sec:.1f}s)")
            success += 1
        else:
            failed.append(voice)
            print("FAILED")

    print("-" * 50)
    print(f"완료: {success}/{len(ALL_VOICES)} 성공")
    if failed:
        print(f"실패: {', '.join(failed)}")
    print(f"파일 위치: {OUTPUT_DIR}")


if __name__ == "__main__":
    main()

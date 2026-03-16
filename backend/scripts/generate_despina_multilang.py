"""
Despina 목소리 일본어/영어 샘플 생성 스크립트

사용법:
  cd backend
  python scripts/generate_despina_multilang.py

출력: backend/voice_samples/ 디렉토리에 WAV 파일 생성
"""

import os
import wave

from dotenv import load_dotenv
load_dotenv()

from google import genai
from google.genai import types

VOICE_NAME = "Despina"
TTS_MODEL = "gemini-2.5-flash-preview-tts"
OUTPUT_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "voice_samples")

SAMPLES = {
    "despina_ja": (
        "こんにちは！私はあなたの数学コーチです。"
        "今日も一緒に楽しく数学の勉強をしましょう！"
        "難しい問題があったら、いつでも聞いてくださいね！"
    ),
    "despina_en": (
        "Hello! I'm your math coach. "
        "Let's have fun studying math together today! "
        "If you have any difficult problems, feel free to ask me anytime!"
    ),
}


def save_wav(filename: str, pcm_data: bytes, channels=1, rate=24000, sample_width=2):
    with wave.open(filename, "wb") as wf:
        wf.setnchannels(channels)
        wf.setsampwidth(sample_width)
        wf.setframerate(rate)
        wf.writeframes(pcm_data)


def generate_sample(client: genai.Client, text: str) -> bytes | None:
    try:
        response = client.models.generate_content(
            model=TTS_MODEL,
            contents=text,
            config=types.GenerateContentConfig(
                response_modalities=["AUDIO"],
                speech_config=types.SpeechConfig(
                    voice_config=types.VoiceConfig(
                        prebuilt_voice_config=types.PrebuiltVoiceConfig(
                            voice_name=VOICE_NAME,
                        )
                    )
                ),
            ),
        )
        return response.candidates[0].content.parts[0].inline_data.data
    except Exception as e:
        print(f"  [ERROR] {e}")
        return None


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

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

    print(f"Voice: {VOICE_NAME}")
    print(f"Output: {OUTPUT_DIR}")
    print("-" * 50)

    for filename, text in SAMPLES.items():
        lang = filename.split("_")[-1].upper()
        print(f"[{lang}] Generating {filename}...", end=" ", flush=True)
        audio_data = generate_sample(client, text)

        if audio_data:
            filepath = os.path.join(OUTPUT_DIR, f"{filename}.wav")
            save_wav(filepath, audio_data)
            duration_sec = len(audio_data) / (24000 * 2)
            print(f"OK ({duration_sec:.1f}s)")
        else:
            print("FAILED")

    print("-" * 50)
    print(f"파일 위치: {OUTPUT_DIR}")


if __name__ == "__main__":
    main()

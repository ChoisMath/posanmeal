"""생성 음성 검수용 전사 워커. TTS 워커와 동시에 돌리지 않는다.

whisper-large-v3-turbo(mlx-community) 저장소에는 토크나이저가 없어 openai 저장소의
tokenizer·preprocessor 파일을 스냅샷 폴더에 복사해 둬야 한다(README 「음성」 절).
"""
import difflib
import json
import re
import sys
from pathlib import Path

STT_MODEL = "mlx-community/whisper-large-v3-turbo"


def normalize(text):
    return re.sub(r"[\s.,!?·~\-\"'“”‘’()]", "", text)


def similarity(expected, transcript):
    return round(difflib.SequenceMatcher(None, normalize(expected), normalize(transcript)).ratio(), 3)


def check(items_path):
    from mlx_audio.stt.utils import load_model

    items = json.loads(Path(items_path).read_text(encoding="utf-8"))
    model = load_model(STT_MODEL)
    for item in items:
        transcript = model.generate(item["wav"], language="ko").text.strip()
        print(json.dumps(
            {"key": item["key"], "transcript": transcript, "similarity": similarity(item["expected"], transcript)},
            ensure_ascii=False,
        ), flush=True)


if __name__ == "__main__":
    check(sys.argv[1])

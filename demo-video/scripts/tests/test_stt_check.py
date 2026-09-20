import sys, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import stt_check


class SimilarityTest(unittest.TestCase):
    def test_ignores_spaces_and_punctuation(self):
        self.assertEqual(stt_check.similarity("설정 화면에서 학급관리 탭을 엽니다.", "설정화면에서 학급관리탭을 엽니다"), 1.0)

    def test_truncated_transcript_scores_low(self):
        self.assertLess(stt_check.similarity("학생관리 화면에서 플러스 학생 버튼을 누르면 학생 정보 입력 창이 열립니다.", "안녕하세요."), 0.3)

    def test_normalize_strips_middle_dot(self):
        self.assertEqual(stt_check.normalize("출결·외출 (신청)"), "출결외출신청")


if __name__ == "__main__":
    unittest.main()

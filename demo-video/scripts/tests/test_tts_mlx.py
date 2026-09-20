import sqlite3, sys, tempfile, unittest, wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import tts_mlx


def make_db(root: Path, reference_text: str = "안녕하세요.") -> Path:
    db = root / "voicebox.db"
    (root / "profiles" / "p1").mkdir(parents=True)
    (root / "profiles" / "p1" / "s1.wav").write_bytes(b"RIFFfake")
    with sqlite3.connect(db) as conn:
        conn.execute("CREATE TABLE profiles (id TEXT PRIMARY KEY, name TEXT UNIQUE)")
        conn.execute("CREATE TABLE profile_samples (id TEXT PRIMARY KEY, profile_id TEXT, audio_path TEXT, reference_text TEXT)")
        conn.execute("INSERT INTO profiles VALUES ('p1', 'Chois')")
        conn.execute("INSERT INTO profile_samples VALUES ('s1', 'p1', 'profiles/p1/s1.wav', ?)", (reference_text,))
    return db


class LoadReferenceTest(unittest.TestCase):
    def test_reads_audio_path_relative_to_db_and_text(self):
        with tempfile.TemporaryDirectory() as tmp:
            db = make_db(Path(tmp))
            audio, text = tts_mlx.load_reference(db, "Chois")
            self.assertEqual(audio, Path(tmp) / "profiles/p1/s1.wav")
            self.assertEqual(text, "안녕하세요.")

    def test_unknown_profile_exits(self):
        with tempfile.TemporaryDirectory() as tmp:
            db = make_db(Path(tmp))
            with self.assertRaises(SystemExit):
                tts_mlx.load_reference(db, "Nobody")


class ReferenceHashTest(unittest.TestCase):
    def test_changes_when_text_changes(self):
        with tempfile.TemporaryDirectory() as tmp:
            audio = Path(tmp) / "a.wav"
            audio.write_bytes(b"same")
            self.assertNotEqual(tts_mlx.reference_hash(audio, "가"), tts_mlx.reference_hash(audio, "나"))
            self.assertEqual(tts_mlx.reference_hash(audio, "가"), tts_mlx.reference_hash(audio, "가"))


class WriteWavTest(unittest.TestCase):
    def test_writes_mono_16bit_and_returns_seconds(self):
        import numpy as np
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "x.wav"
            seconds = tts_mlx.write_wav(out, np.zeros(24000, dtype=np.float32), 24000)
            self.assertAlmostEqual(seconds, 1.0)
            with wave.open(str(out)) as w:
                self.assertEqual((w.getnchannels(), w.getsampwidth(), w.getframerate()), (1, 2, 24000))


class SingleUnpaddedDecodeLengthTest(unittest.TestCase):
    def make_tokenizer(self, waveform, lengths):
        class Tokenizer:
            decode_upsample_rate = 1920

            def decode(self, codes):
                self.received_codes = codes
                return waveform, lengths

        return Tokenizer()

    def test_preserves_zero_codec_frames_and_native_waveform(self):
        import numpy as np

        codes = np.array([[[4, 2], [0, 7], [9, 3]]], dtype=np.int32)
        waveform = np.arange(3 * 1920, dtype=np.float32)[None, :]
        for dtype in (np.int32, np.int64):
            with self.subTest(dtype=dtype):
                original_lengths = np.array([2 * 1920], dtype=dtype)
                tokenizer = self.make_tokenizer(waveform, original_lengths)
                tts_mlx.preserve_single_unpadded_decode_length(tokenizer)

                decoded, lengths = tokenizer.decode(codes)

                self.assertIs(decoded, waveform)
                self.assertIs(tokenizer.received_codes, codes)
                self.assertEqual(lengths.tolist(), [3 * 1920])
                self.assertEqual(lengths.dtype, original_lengths.dtype)
                self.assertEqual(lengths.shape, original_lengths.shape)
                self.assertEqual(original_lengths.tolist(), [2 * 1920])

    def test_reference_zero_does_not_remove_the_generated_ending(self):
        import numpy as np

        codes = np.array([[[4], [0], [9], [2], [8], [3]]], dtype=np.int32)
        waveform = np.arange(6 * 1920, dtype=np.float32)[None, :]
        tokenizer = self.make_tokenizer(waveform, np.array([5 * 1920]))
        tts_mlx.preserve_single_unpadded_decode_length(tokenizer)

        decoded, lengths = tokenizer.decode(codes)
        trimmed = decoded[0, :int(lengths[0])]
        reference_cut = int(2 / codes.shape[1] * trimmed.shape[0])

        np.testing.assert_array_equal(trimmed[reference_cut:], waveform[0, 2 * 1920:])

    def test_clamps_to_the_decoded_waveform_length(self):
        import numpy as np

        waveform = np.zeros((1, 317), dtype=np.float32)
        tokenizer = self.make_tokenizer(waveform, np.array([0], dtype=np.int32))
        tts_mlx.preserve_single_unpadded_decode_length(tokenizer)

        decoded, lengths = tokenizer.decode(np.zeros((1, 2, 16), dtype=np.int32))

        self.assertIs(decoded, waveform)
        self.assertEqual(lengths.tolist(), [317])

    def test_possible_padded_batches_keep_native_lengths(self):
        import numpy as np

        waveform = np.zeros((2, 3 * 1920), dtype=np.float32)
        original_lengths = np.array([1920, 3 * 1920], dtype=np.int32)
        tokenizer = self.make_tokenizer(waveform, original_lengths)
        tts_mlx.preserve_single_unpadded_decode_length(tokenizer)

        decoded, lengths = tokenizer.decode(np.zeros((2, 3, 16), dtype=np.int32))

        self.assertIs(decoded, waveform)
        self.assertIs(lengths, original_lengths)

    def test_other_input_shapes_keep_the_native_contract(self):
        import numpy as np

        waveform = np.zeros((1, 1920), dtype=np.float32)
        original_lengths = np.array([1920], dtype=np.int32)
        for shape in ((3, 16), (1, 1, 3, 16)):
            with self.subTest(shape=shape):
                tokenizer = self.make_tokenizer(waveform, original_lengths)
                tts_mlx.preserve_single_unpadded_decode_length(tokenizer)

                decoded, lengths = tokenizer.decode(np.zeros(shape, dtype=np.int32))

                self.assertIs(decoded, waveform)
                self.assertIs(lengths, original_lengths)


if __name__ == "__main__":
    unittest.main()

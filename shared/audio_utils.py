"""Аудио утилиты для NurChat"""
import io
import wave

import pyaudio


class AudioRecorder:
    """Генерация и обработка аудио в NurChat"""

    def __init__(self, chunk=1024, format=pyaudio.paInt16, channels=1, rate=44100):
        self.chunk = chunk
        self.format = format
        self.channels = channels
        self.rate = rate
        self.audio = pyaudio.PyAudio()

    def record(self, duration: int) -> bytes:
        """Запись аудио с микрофона"""
        stream = self.audio.open(format=self.format,
                                 channels=self.channels,
                                 rate=self.rate,
                                 input=True,
                                 frames_per_buffer=self.chunk)

        frames = []
        for _ in range(0, int(self.rate / self.chunk * duration)):
            data = stream.read(self.chunk)
            frames.append(data)

        stream.stop_stream()
        stream.close()

        audio_data = b''.join(frames)
        return audio_data

    def save_to_wav(self, audio_data: bytes) -> bytes:
        """Сохранение аудио данных в формате WAV"""
        buffer = io.BytesIO()
        with wave.open(buffer, 'wb') as wf:
            wf.setnchannels(self.channels)
            wf.setsampwidth(self.audio.get_sample_size(self.format))
            wf.setframerate(self.rate)
            wf.writeframes(audio_data)
        return buffer.getvalue()

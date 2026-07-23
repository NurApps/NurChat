"""
Запуск NurChat: сервер (FastAPI) + Tauri (React)
"""
import os
import signal
import subprocess
import sys
import time

import requests


class NurChatRunner:
    """Запуск сервера и Tauri клиента NurChat"""

    def __init__(self):
        self.server_process = None
        self.server_url = "http://127.0.0.1:8000/health"

    def start_server(self):
        """Запуск FastAPI сервера"""
        print("Запуск сервера NurChat...")
        os.makedirs("logs", exist_ok=True)

        server_out = open("logs/server.log", "w")
        server_err = open("logs/server.err.log", "w")

        self.server_process = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "server.main:app",
             "--host", "0.0.0.0", "--port", "8000", "--reload"],
            stdout=server_out, stderr=server_err,
        )
        return self.server_process

    def start_tauri(self):
        """Запуск Tauri клиента"""
        print("Запуск Tauri клиента...")
        subprocess.Popen(["npx", "tauri", "dev"])

    def wait_for_server(self, timeout=60):
        """Ожидание запуска сервера"""
        print("Ожидание запуска сервера...")
        start_time = time.time()

        while time.time() - start_time < timeout:
            try:
                response = requests.get(self.server_url, timeout=5)
                if response.status_code == 200:
                    print("Сервер запущен!")
                    return True
            except requests.exceptions.RequestException:
                pass
            time.sleep(1)

        print("Сервер не запустился вовремя")
        return False

    def run(self):
        """Запуск сервера и Tauri"""
        print("Запуск NurChat...")

        self.start_server()

        if not self.wait_for_server():
            print("Не удалось запустить сервер")
            return False

        self.start_tauri()

        print("NurChat запущен! Ctrl+C для остановки.")

        try:
            if self.server_process:
                self.server_process.wait()
        except KeyboardInterrupt:
            print("\nОстановка...")
        finally:
            self.stop()

        return True

    def stop(self):
        """Остановка"""
        if self.server_process:
            try:
                self.server_process.terminate()
                self.server_process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.server_process.kill()
        print("NurChat остановлен.")


def main():
    runner = NurChatRunner()

    def signal_handler(signum, frame):
        runner.stop()
        sys.exit(0)

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    if not runner.run():
        sys.exit(1)


if __name__ == "__main__":
    main()

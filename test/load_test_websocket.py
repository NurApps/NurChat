"""
Нагрузочное тестирование WebSocket NurChat
Простая версия для проверки 100+ соединений
"""
import asyncio
import sys
import threading
import time
from datetime import datetime

import requests
import websockets

BASE_URL = "http://127.0.0.1:8000"
WS_URL = "ws://127.0.0.1:8000/ws/chat"


class LoadTestResults:
    def __init__(self):
        self.total_connections = 0
        self.successful_connections = 0
        self.failed_connections = 0
        self.errors = []
        self.connection_times = []
        self.max_concurrent = 0
        self.current_concurrent = 0
        self.lock = threading.Lock()

    def add_connection(self, success, connection_time=None):
        with self.lock:
            self.total_connections += 1
            if success:
                self.successful_connections += 1
                if connection_time:
                    self.connection_times.append(connection_time)
            else:
                self.failed_connections += 1

    def add_error(self, error_msg):
        with self.lock:
            self.errors.append(error_msg)

    def update_concurrent(self, count):
        with self.lock:
            self.current_concurrent = count
            if count > self.max_concurrent:
                self.max_concurrent = count

    def summary(self):
        print(f"\n{'='*60}")
        print("РЕЗУЛЬТАТЫ НАГРУЗОЧНОГО ТЕСТИРОВАНИЯ")
        print(f"{'='*60}")
        print(f"Всего попыток подключения: {self.total_connections}")
        print(f"Успешные подключения: {self.successful_connections}")
        print(f"Неудачные подключения: {self.failed_connections}")
        if self.total_connections > 0:
            print(f"Успешность подключений: {self.successful_connections/self.total_connections*100:.1f}%")
        print(f"Максимум одновременных соединений: {self.max_concurrent}")

        if self.connection_times:
            avg_time = sum(self.connection_times) / len(self.connection_times)
            min_time = min(self.connection_times)
            max_time = max(self.connection_times)
            print("\nВремя подключения:")
            print(f"  Среднее: {avg_time*1000:.2f}ms")
            print(f"  Мин: {min_time*1000:.2f}ms")
            print(f"  Макс: {max_time*1000:.2f}ms")

        if self.errors:
            print(f"\nОШИБКИ ({len(self.errors)}):")
            for i, err in enumerate(self.errors[:5]):
                print(f"  {i+1}. {err}")
            if len(self.errors) > 5:
                print(f"  ... и еще {len(self.errors) - 5} ошибок")

        # Критерий готовности: 100+ одновременных соединений
        success = self.max_concurrent >= 100 and self.successful_connections >= 100
        print(f"\n{'='*60}")
        if success:
            print("КРИТЕРИЙ ГОТОВНОСТИ: ВЫПОЛНЕН (100+ соединений)")
        else:
            print("КРИТЕРИЙ ГОТОВНОСТИ: НЕ ВЫПОЛНЕН")
            print("  Требуется: 100+ одновременных соединений")
            print(f"  Достигнуто: {self.max_concurrent}")
        print(f"{'='*60}")

        return success


async def websocket_client(client_id, results, connected_count, stop_event):
    """WebSocket клиент для нагрузочного тестирования"""
    try:
        user_id = f"loadtest_{client_id}"
        start_time = time.time()

        try:
            async with websockets.connect(f"{WS_URL}/{user_id}", ping_timeout=None, close_timeout=5) as websocket:
                connection_time = time.time() - start_time
                results.add_connection(True, connection_time)

                # Увеличиваем счетчик подключенных
                new_count = connected_count.add(1)
                results.update_concurrent(new_count)

                # Держим соединение
                for _ in range(20):  # 10 секунд
                    if stop_event.is_set():
                        break
                    try:
                        await asyncio.wait_for(websocket.recv(), timeout=0.5)
                    except asyncio.TimeoutError:
                        pass

        except Exception as ws_error:
            results.add_connection(False)
            results.add_error(f"Client {client_id}: {str(ws_error)}")

    except Exception as e:
        results.add_connection(False)
        results.add_error(f"Client {client_id}: {str(e)}")


class AtomicCounter:
    def __init__(self, initial=0):
        self._value = initial
        self._lock = threading.Lock()

    def add(self, delta=1):
        with self._lock:
            self._value += delta
            return self._value

    @property
    def value(self):
        return self._value


async def run_load_test(num_clients=120):
    """Запуск нагрузочного теста"""
    print("="*60)
    print("НАГРУЗОЧНОЕ ТЕСТИРОВАНИЕ WebSocket NURCHAT")
    print("="*60)
    print(f"Время начала: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Количество клиентов: {num_clients}")
    print("Цель: 100+ одновременных соединений")
    print()

    results = LoadTestResults()
    connected_count = AtomicCounter(0)
    stop_event = asyncio.Event()

    print(f"Подключение {num_clients} клиентов...")
    start_time = time.time()

    # Запускаем всех клиентов
    tasks = [
        asyncio.create_task(
            websocket_client(i, results, connected_count, stop_event)
        )
        for i in range(num_clients)
    ]

    # Ждем выполнения с таймаутом
    try:
        await asyncio.wait_for(
            asyncio.gather(*tasks, return_exceptions=True),
            timeout=30
        )
    except asyncio.TimeoutError:
        print("Timeout waiting for clients")
        stop_event.set()
    except Exception as e:
        print(f"Error: {e}")
        stop_event.set()

    total_time = time.time() - start_time

    print(f"\nТест завершен за {total_time:.2f} секунд")
    print(f"Максимум одновременных подключений: {results.max_concurrent}")

    return results


def run_stress_test():
    """Запуск стресс-теста"""
    print("="*60)
    print("СТРЕСС-ТЕСТ WebSocket NURCHAT")
    print("="*60)

    # Проверяем доступность сервера
    try:
        response = requests.get(f"{BASE_URL}/health", timeout=5)
        if response.status_code != 200:
            print(f"Сервер недоступен: {BASE_URL}")
            return False
        print(f"Сервер доступен: {BASE_URL}")
    except Exception as e:
        print(f"Сервер недоступен: {e}")
        return False

    # Запускаем тест
    num_clients = 120
    results = asyncio.run(run_load_test(num_clients))

    return results.summary()


if __name__ == "__main__":
    success = run_stress_test()
    sys.exit(0 if success else 1)

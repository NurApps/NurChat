"""
WebSocket Load Test for NurChat
Tests 100 concurrent connections with message send/receive
"""
import asyncio
import statistics
import time
from dataclasses import dataclass, field

import websockets

BASE_URL = "http://127.0.0.1:8000"
WS_URL = "ws://127.0.0.1:8000/ws/chat"


@dataclass
class LoadTestResults:
    total_connections: int = 0
    successful_connections: int = 0
    failed_connections: int = 0
    connection_times: list = field(default_factory=list)
    message_latencies: list = field(default_factory=list)
    errors: list = field(default_factory=list)
    max_concurrent: int = 0
    current_concurrent: int = 0
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    async def add_connection(self, success: bool, connection_time: float = 0):
        async with self.lock:
            self.total_connections += 1
            if success:
                self.successful_connections += 1
                if connection_time:
                    self.connection_times.append(connection_time)
            else:
                self.failed_connections += 1

    async def add_message_latency(self, latency: float):
        async with self.lock:
            self.message_latencies.append(latency)

    async def add_error(self, error_msg: str):
        async with self.lock:
            self.errors.append(error_msg)

    async def update_concurrent(self, count: int):
        async with self.lock:
            self.current_concurrent = count
            if count > self.max_concurrent:
                self.max_concurrent = count

    def summary(self) -> dict:
        result = {
            "total_connections": self.total_connections,
            "successful_connections": self.successful_connections,
            "failed_connections": self.failed_connections,
            "success_rate": (self.successful_connections / self.total_connections * 100) if self.total_connections > 0 else 0,
            "max_concurrent": self.max_concurrent,
            "connections_per_sec": self.successful_connections / max(self.connection_times) if self.connection_times else 0,
        }

        if self.connection_times:
            result["avg_connection_time_ms"] = statistics.mean(self.connection_times) * 1000
            result["min_connection_time_ms"] = min(self.connection_times) * 1000
            result["max_connection_time_ms"] = max(self.connection_times) * 1000

        if self.message_latencies:
            result["avg_message_latency_ms"] = statistics.mean(self.message_latencies) * 1000
            result["p95_message_latency_ms"] = sorted(self.message_latencies)[int(len(self.message_latencies) * 0.95)] * 1000
            result["p99_message_latency_ms"] = sorted(self.message_latencies)[int(len(self.message_latencies) * 0.99)] * 1000

        result["errors"] = self.errors[:10]
        result["passed"] = self.max_concurrent >= 100 and self.successful_connections >= 100

        return result


class AtomicCounter:
    def __init__(self, initial: int = 0):
        self._value = initial
        self._lock = asyncio.Lock()

    async def add(self, delta: int = 1) -> int:
        async with self._lock:
            self._value += delta
            return self._value


async def websocket_client(
    client_id: int,
    results: LoadTestResults,
    connected_count: AtomicCounter,
    send_message: bool = True,
):
    """Single WebSocket client for load testing."""
    user_id = f"loadtest_{client_id}"
    start_time = time.time()

    try:
        async with websockets.connect(
            f"{WS_URL}/{user_id}",
            ping_timeout=None,
            close_timeout=5,
        ) as websocket:
            connection_time = time.time() - start_time
            await results.add_connection(True, connection_time)

            new_count = await connected_count.add(1)
            await results.update_concurrent(new_count)

            # Send a test message
            if send_message:
                msg = {
                    "event": "message",
                    "data": {
                        "chat_id": "loadtest_chat",
                        "content": f"Test message from {user_id}",
                        "message_type": "text",
                    },
                }
                msg_start = time.time()
                await websocket.send_json(msg)

                # Wait for delivery confirmation
                try:
                    await asyncio.wait_for(websocket.recv(), timeout=2.0)
                    latency = time.time() - msg_start
                    await results.add_message_latency(latency)
                except asyncio.TimeoutError:
                    pass

            # Hold connection briefly
            await asyncio.sleep(0.5)

            new_count = await connected_count.add(-1)
            await results.update_concurrent(new_count)

    except Exception as e:
        await results.add_connection(False)
        await results.add_error(f"Client {client_id}: {str(e)}")


async def run_load_test(num_clients: int = 120) -> dict:
    """Run WebSocket load test with concurrent clients."""
    results = LoadTestResults()
    connected_count = AtomicCounter(0)

    print(f"Starting load test with {num_clients} clients...")
    start_time = time.time()

    tasks = [
        asyncio.create_task(websocket_client(i, results, connected_count))
        for i in range(num_clients)
    ]

    try:
        await asyncio.wait_for(
            asyncio.gather(*tasks, return_exceptions=True),
            timeout=30,
        )
    except asyncio.TimeoutError:
        print("Timeout waiting for clients")
    except Exception as e:
        print(f"Error: {e}")

    total_time = time.time() - start_time
    summary = results.summary()
    summary["total_time_sec"] = total_time

    print(f"\nTest completed in {total_time:.2f} seconds")
    print(f"Max concurrent: {summary['max_concurrent']}")
    print(f"Connections/sec: {summary['connections_per_sec']:.1f}")

    if summary.get("avg_message_latency_ms"):
        print(f"Avg message latency: {summary['avg_message_latency_ms']:.1f}ms")
        print(f"P95 message latency: {summary['p95_message_latency_ms']:.1f}ms")

    return summary


if __name__ == "__main__":
    import requests

    # Check server health
    try:
        resp = requests.get(f"{BASE_URL}/health", timeout=5)
        if resp.status_code != 200:
            print(f"Server unavailable: {BASE_URL}")
            exit(1)
        print(f"Server available: {BASE_URL}")
    except Exception as e:
        print(f"Server unavailable: {e}")
        exit(1)

    summary = asyncio.run(run_load_test(120))

    print(f"\n{'='*60}")
    print("RESULTS:")
    print(f"{'='*60}")
    for k, v in summary.items():
        if k != "errors":
            print(f"  {k}: {v}")

    if summary["errors"]:
        print(f"\nErrors ({len(summary['errors'])}):")
        for err in summary["errors"][:5]:
            print(f"  - {err}")

    print(f"\n{'='*60}")
    if summary["passed"]:
        print("PASSED: 100+ concurrent connections achieved")
    else:
        print("FAILED: Need 100+ concurrent connections")
    print(f"{'='*60}")

    exit(0 if summary["passed"] else 1)

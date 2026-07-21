"""Test CSRF + registration flow"""
import requests
import re
import uuid

s = requests.Session()

r1 = s.get("http://127.0.0.1:8000/api/auth/captcha")
print(f"captcha: {r1.json()}")

cap = r1.json()
m = re.match(r"(\d+)\s*\+\s*(\d+)", cap["question"])
answer = str(int(m.group(1)) + int(m.group(2))) if m else "42"

username = "testuser_" + str(uuid.uuid4())[:6]
body = {
    "user_data": {
        "username": username,
        "first_name": "Test",
        "last_name": "User",
        "password": "testpass123",
    },
    "captcha_id": cap["captcha_id"],
    "captcha_code": answer,
}

r2 = s.post("http://127.0.0.1:8000/api/auth/register", json=body)
print(f"register status: {r2.status_code}")
print(f"register body: {r2.text[:300]}")

if r2.ok:
    data = r2.json()
    print(f"\nSUCCESS! Token: {data.get('access_token', 'N/A')[:60]}...")
    print(f"User ID: {data.get('user_id', 'N/A')}")

"""
CAPTCHA generation and validation for NurChat
Uses simple math/image-based CAPTCHA to prevent bot registrations
"""
import random
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple

from shared.config import settings


class CaptchaManager:
    """Manages CAPTCHA generation and validation"""
    
    def __init__(self, ttl_minutes: int = 5):
        self.ttl = timedelta(minutes=ttl_minutes)
        # In-memory storage for captcha sessions (use Redis in production)
        self._captcha_store: dict[str, dict] = {}
    
    def generate_captcha(self) -> Tuple[str, str]:
        """
        Generate a new CAPTCHA challenge
        
        Returns:
            tuple: (captcha_id, image_data_url)
        """
        captcha_id = f"captcha_{secrets.token_hex(16)}"
        
        # Generate simple math captcha
        num1 = random.randint(1, 10)
        num2 = random.randint(1, 10)
        answer = num1 + num2
        
        # Store the answer with expiration
        self._captcha_store[captcha_id] = {
            "answer": str(answer),
            "question": f"{num1} + {num2} = ?",
            "created_at": datetime.now(timezone.utc),
        }
        
        # Clean up old captchas
        self._cleanup_old_captchas()
        
        return captcha_id, f"{num1} + {num2} = ?"
    
    def validate_captcha(self, captcha_id: str, answer: str) -> bool:
        """
        Validate CAPTCHA answer
        
        Args:
            captcha_id: The CAPTCHA session ID
            answer: User's answer
            
        Returns:
            bool: True if valid, False otherwise
        """
        if not captcha_id or not answer:
            return False
        
        captcha_data = self._captcha_store.get(captcha_id)
        if not captcha_data:
            return False
        
        # Check expiration
        created_at = captcha_data["created_at"]
        if datetime.now(timezone.utc) - created_at > self.ttl:
            # Remove expired captcha
            del self._captcha_store[captcha_id]
            return False
        
        # Validate answer (case-insensitive, strip whitespace)
        expected_answer = captcha_data["answer"].strip().lower()
        user_answer = str(answer).strip().lower()
        
        is_valid = expected_answer == user_answer
        
        # Remove captcha after use (one-time use)
        if is_valid:
            del self._captcha_store[captcha_id]
        
        return is_valid
    
    def _cleanup_old_captchas(self):
        """Remove expired CAPTCHAs from storage"""
        now = datetime.now(timezone.utc)
        expired_keys = [
            k for k, v in self._captcha_store.items()
            if now - v["created_at"] > self.ttl
        ]
        for key in expired_keys:
            del self._captcha_store[key]
    
    def get_captcha_question(self, captcha_id: str) -> Optional[str]:
        """Get the question for a given captcha_id (for frontend display)"""
        captcha_data = self._captcha_store.get(captcha_id)
        if captcha_data:
            return captcha_data.get("question")
        return None


# Global captcha manager instance
captcha_manager = CaptchaManager(ttl_minutes=5)


def generate_captcha() -> Tuple[str, str]:
    """Generate a new CAPTCHA"""
    return captcha_manager.generate_captcha()


def validate_captcha(captcha_id: str, answer: str) -> bool:
    """Validate a CAPTCHA answer"""
    return captcha_manager.validate_captcha(captcha_id, answer)


def get_captcha_question(captcha_id: str) -> Optional[str]:
    """Get CAPTCHA question for display"""
    return captcha_manager.get_captcha_question(captcha_id)

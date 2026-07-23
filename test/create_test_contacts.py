
import os
import sys

# Добавляем путь к проекту в sys.path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from server.core.database import SessionLocal
from server.core.models import Contact, User
from server.core.security import encryption, security
from server.utils.security import hash_password

test_contacts = [
    {
        "username": "Ahmed",
        "password": "Ahmed123"
    },
    {
        "username": "Fatima",
        "password": "Fatima123"
    },
    {
        "username": "Omar",
        "password": "Omar123"
    },
    {
        "username": "Aisha",
        "password": "Aisha123"
    },
    {
        "username": "Hassan",
        "password": "Hassan123"
    },
    {
        "username": "Zainab",
        "password": "Zainab123"
    },
    {
        "username": "Yusuf",
        "password": "Yusuf123"
    },
    {
        "username": "Salih",
        "password": "Salih123"
    },
]

def create_test_contacts():
    """Создание тестовых контактов"""
    db = SessionLocal()

    try:
        # Создаем тестовых пользователей
        created_users = []
        for contact_data in test_contacts:
            # Проверяем, существует ли пользователь
            existing_user = db.query(User).filter(
                User.username == contact_data["username"]
            ).first()

            if existing_user:
                print(f"Пользователь {contact_data['username']} уже существует")
                created_users.append(existing_user)
                continue

            # Хэшируем пароль
            hashed_password = hash_password(contact_data["password"])

            # Генерируем ключи для E2E шифрования
            keypair = encryption.generate_keypair()

            # Создаем пользователя
            user_id = security.generate_user_id()
            user = User(
                id=user_id,
                username=contact_data["username"],
                hashed_password=hashed_password,
                public_key=keypair['public_key']
            )

            db.add(user)
            db.commit()
            db.refresh(user)

            print(f"Создан пользователь: {user.username} (ID: {user.id})")
            created_users.append(user)

        # Получаем ID текущего пользователя (первого созданного или существующего)
        if not created_users:
            print("Не удалось создать ни одного пользователя")
            return

        # Добавляем созданных пользователей как контакты друг к другу
        for i, user in enumerate(created_users):
            for j, other_user in enumerate(created_users):
                if i != j:
                    # Проверяем, существует ли контакт
                    existing_contact = db.query(Contact).filter(
                        Contact.user_id == user.id,
                        Contact.contact_user_id == other_user.id
                    ).first()

                    if not existing_contact:
                        # Создаем контакт
                        contact_id = security.generate_contact_id()
                        contact = Contact(
                            id=contact_id,
                            user_id=user.id,
                            contact_user_id=other_user.id
                        )

                        db.add(contact)
                        db.commit()
                        db.refresh(contact)

                        print(f"Контакт {other_user.username} добавлен для пользователя {user.username}")

        print("\nТестовые контакты успешно созданы!")
        print("\nСписок пользователей:")
        for user in created_users:
            print(f"- {user.username} (ID: {user.id}, Пароль: {next(c['password'] for c in test_contacts if c['username'] == user.username)})")

    except Exception as e:
        print(f"Ошибка при создании тестовых контактов: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    create_test_contacts()

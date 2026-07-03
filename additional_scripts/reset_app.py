import os
import shutil
import time


def reset_nurchat_app():
    """Полный сброс приложения NurChat к начальному состоянию"""

    print("=== Full Reset of NurChat Application ===")
    print("This will remove all data and restart with a clean installation.")
    print()

    # Удаляем токен авторизации
    token_file = "token.txt"
    if os.path.exists(token_file):
        try:
            os.remove(token_file)
            print(f"✓ Removed token file: {token_file}")
        except Exception as e:
            print(f"✗ Could not remove token file: {e}")
    else:
        print(f"- Token file {token_file} not found")

    # Удаляем папку с медиафайлами, если она есть
    media_dir = "media"
    if os.path.exists(media_dir) and os.path.isdir(media_dir):
        try:
            shutil.rmtree(media_dir)
            print(f"✓ Removed media directory: {media_dir}")
        except Exception as e:
            print(f"✗ Could not remove media directory: {e}")

    # Удаляем папку с логами, если она есть
    logs_dir = "logs"
    if os.path.exists(logs_dir) and os.path.isdir(logs_dir):
        try:
            shutil.rmtree(logs_dir)
            print(f"✓ Removed logs directory: {logs_dir}")
        except Exception as e:
            print(f"✗ Could not remove logs directory: {e}")

    # Удаляем папку с кэшем Python, если она есть
    cache_dirs = ["__pycache__", "server/__pycache__", "client/__pycache__", "shared/__pycache__"]
    for cache_dir in cache_dirs:
        if os.path.exists(cache_dir) and os.path.isdir(cache_dir):
            try:
                shutil.rmtree(cache_dir)
                print(f"✓ Removed cache directory: {cache_dir}")
            except Exception as e:
                print(f"✗ Could not remove cache directory {cache_dir}: {e}")

    # Попробуем переименовать файл базы данных, чтобы освободить его
    db_file = "nurchat.db"
    if os.path.exists(db_file):
        backup_name = f"{db_file}.backup_{int(time.time())}"
        try:
            os.rename(db_file, backup_name)
            print(f"✓ Renamed database file to: {backup_name} (was locked)")
            print("  The original DB will be recreated on next startup")
        except Exception as e:
            print(f"✗ Could not rename database file (it may be in use): {e}")
            print("  Please close all Python processes and try again")
    else:
        print(f"- Database file {db_file} not found")

    print()
    print("=== Reset Complete ===")
    print("To start the application with a fresh database:")
    print("1. Make sure all Python processes are closed")
    print("2. Run: python run.py")
    print()
    print("This will recreate the database with default settings.")

if __name__ == "__main__":
    reset_nurchat_app()

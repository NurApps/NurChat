import os
import subprocess
import sys


def clean_and_start_nurchat():
    """Очистка и запуск NurChat с новой базой данных"""

    print("Cleaning and starting NurChat with fresh database...")

    # Удаляем токен, если он есть
    if os.path.exists("token.txt"):
        os.remove("token.txt")
        print("Removed token.txt")

    # Удаляем папки с кэшем
    cache_dirs = ["__pycache__", "server/__pycache__", "client/__pycache__", "shared/__pycache__"]
    for cache_dir in cache_dirs:
        if os.path.exists(cache_dir) and os.path.isdir(cache_dir):
            import shutil
            try:
                shutil.rmtree(cache_dir)
                print(f"Removed cache directory: {cache_dir}")
            except Exception as e:
                print(f"Could not remove cache directory {cache_dir}: {e}")

    # Запускаем приложение
    print("Starting NurChat application...")
    print("Please note: If you see an error about the database being locked,")
    print("please close all other Python processes and try again.")

    # Запускаем run.py
    try:
        subprocess.run([sys.executable, "run.py"], check=True)
    except subprocess.CalledProcessError as e:
        print(f"Error running NurChat: {e}")
        print("Make sure all previous instances of the application are closed.")

if __name__ == "__main__":
    clean_and_start_nurchat()

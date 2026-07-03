import os
import shutil

import psutil


def kill_processes_by_name(process_name):
    """Убить все процессы с заданным именем"""
    killed_processes = []
    for proc in psutil.process_iter(['pid', 'name']):
        try:
            if process_name.lower() in proc.info['name'].lower():
                proc.kill()
                killed_processes.append(proc.info['pid'])
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            pass
    return killed_processes

def force_reset_nurchat_app():
    """Полный сброс приложения NurChat к начальному состоянию"""

    print("Force resetting NurChat application...")

    # Убиваем все связанные процессы
    print("Terminating related processes...")
    killed_pids = []
    for proc_name in ["python.exe", "uvicorn.exe", "flet.exe"]:
        killed = kill_processes_by_name(proc_name)
        killed_pids.extend(killed)
        if killed:
            print(f"Killed processes {proc_name}: {killed}")

    if killed_pids:
        print(f"Total processes killed: {len(killed_pids)}")

    # Ждем немного, чтобы процессы точно завершились
    import time
    time.sleep(2)

    # Удаляем файл базы данных
    db_file = "nurchat.db"
    if os.path.exists(db_file):
        try:
            os.remove(db_file)
            print(f"SUCCESS: Deleted database file: {db_file}")
        except Exception as e:
            print(f"WARNING: Could not delete database file {db_file}: {e}")
    else:
        print(f"INFO: Database file {db_file} not found")

    # Удаляем токен авторизации
    token_file = "token.txt"
    if os.path.exists(token_file):
        try:
            os.remove(token_file)
            print(f"SUCCESS: Deleted token file: {token_file}")
        except Exception as e:
            print(f"ERROR: Failed to delete token: {e}")
    else:
        print(f"INFO: Token file {token_file} not found")

    # Удаляем папку с медиафайлами, если она есть
    media_dir = "media"
    if os.path.exists(media_dir) and os.path.isdir(media_dir):
        try:
            shutil.rmtree(media_dir)
            print(f"SUCCESS: Deleted media directory: {media_dir}")
        except Exception as e:
            print(f"ERROR: Failed to delete media directory: {e}")

    # Удаляем папку с логами, если она есть
    logs_dir = "logs"
    if os.path.exists(logs_dir) and os.path.isdir(logs_dir):
        try:
            shutil.rmtree(logs_dir)
            print(f"SUCCESS: Deleted logs directory: {logs_dir}")
        except Exception as e:
            print(f"ERROR: Failed to delete logs directory: {e}")

    # Удаляем папку с кэшем Python, если она есть
    cache_dirs = ["__pycache__", "server/__pycache__", "client/__pycache__", "shared/__pycache__"]
    for cache_dir in cache_dirs:
        if os.path.exists(cache_dir) and os.path.isdir(cache_dir):
            try:
                shutil.rmtree(cache_dir)
                print(f"SUCCESS: Deleted cache directory: {cache_dir}")
            except Exception as e:
                print(f"ERROR: Failed to delete cache directory {cache_dir}: {e}")

    print("\nForce reset complete!")
    print("You can now run the application again with a clean database.")
    print("To start the application, use the command: python run.py")

if __name__ == "__main__":
    force_reset_nurchat_app()

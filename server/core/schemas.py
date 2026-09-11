# server/core/schemas.py - экспорт общих схем

from shared.schemas import *  # noqa: F401, F403

# Обновляем ссылки для рекурсивных типов
MessageResponse.model_rebuild()
ChatResponse.model_rebuild()
FileResponse.model_rebuild()
CallResponse.model_rebuild()
ContactResponse.model_rebuild()
GroupInviteResponse.model_rebuild()
BlockedUserResponse.model_rebuild()

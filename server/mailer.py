import os
import smtplib
from email.mime.text import MIMEText

GMAIL_ADDRESS      = os.getenv("GMAIL_ADDRESS") or None
GMAIL_APP_PASSWORD = os.getenv("GMAIL_APP_PASSWORD") or None


def send_verification_code(to_email: str, code: str) -> bool:
    """Отправляет код верификации через Gmail SMTP (App Password, см. server/.env).
    Никогда не бросает — вызывающий код (register/resend/change-email) не должен падать
    из-за временной проблемы с почтой, а сам факт "код не пришёл" уже достаточный сигнал
    пользователю (см. диалог: заранее проверить существование почтового ящика синхронно
    всё равно нельзя — SMTP примет письмо, даже если ящик не существует, реальный bounce
    придёт асинхронно и не в рамках этого запроса).
    Если GMAIL_ADDRESS/GMAIL_APP_PASSWORD не заданы в .env — печатает код в лог сервера
    вместо реальной отправки, чтобы локальная разработка не требовала настоящего SMTP."""
    # RU+EN в одном письме — UI игры сейчас чисто русский (см. i18n в CLAUDE.md), но
    # почтовый клиент/язык получателя мы не знаем, а дублирование одной короткой фразы
    # стоит копейки и снимает риск "непонятного письма" для не-русскоязычного игрока.
    subject = "Stellar Drift — подтверждение почты / Email confirmation"
    body = (
        f"Ваш код подтверждения: {code}\n"
        f"Код действителен 30 минут. Если это были не вы — просто проигнорируйте письмо.\n"
        f"\n---\n\n"
        f"Your verification code: {code}\n"
        f"The code is valid for 30 minutes. If this wasn't you, just ignore this email."
    )

    if not GMAIL_ADDRESS or not GMAIL_APP_PASSWORD:
        print(f"[mailer] SMTP не настроен (server/.env) — код верификации для {to_email}: {code}")
        return False

    msg = MIMEText(body)
    msg["Subject"] = subject
    msg["From"] = GMAIL_ADDRESS
    msg["To"] = to_email

    try:
        with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=10) as server:
            server.login(GMAIL_ADDRESS, GMAIL_APP_PASSWORD)
            server.sendmail(GMAIL_ADDRESS, [to_email], msg.as_string())
        return True
    except Exception as e:
        print(f"[mailer] Ошибка отправки на {to_email}: {e} — код (для отладки): {code}")
        return False

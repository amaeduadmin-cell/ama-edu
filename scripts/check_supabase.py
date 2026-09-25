import os
from supabase import create_client

url = os.environ["SUPABASE_URL"]
key = os.environ["SUPABASE_KEY"]
client = create_client(url, key)

checks = [
    ("notifications", lambda: client.table("notifications").select("id").limit(1).execute()),
    ("unlock_request_students", lambda: client.table("score_unlock_request_students").select("id").limit(1).execute()),
    ("unlock_request_analytics", lambda: client.rpc("unlock_request_analytics", {"p_term_id": "00000000-0000-0000-0000-000000000000"}).execute()),
    ("mark_notification_read", lambda: client.rpc("mark_notification_read", {"p_notification_id": "00000000-0000-0000-0000-000000000000"}).execute()),
    ("submit_score_period", lambda: client.rpc("submit_score_period", {"p_class_id":"00000000-0000-0000-0000-000000000000","p_subject_id":"00000000-0000-0000-0000-000000000000","p_term_id":"00000000-0000-0000-0000-000000000000","p_period":"ca1"}).execute()),
    ("request_score_unlock", lambda: client.rpc("request_score_unlock", {"p_class_id":"00000000-0000-0000-0000-000000000000","p_subject_id":"00000000-0000-0000-0000-000000000000","p_term_id":"00000000-0000-0000-0000-000000000000","p_period":"ca1","p_student_ids":[],"p_reason":"probe"}).execute()),
]

for name, operation in checks:
    try:
        result = operation()
        print(f"{name}: available; data={str(getattr(result, 'data', None))[:160]}")
    except Exception as exc:
        text = str(exc).replace(os.environ.get("SUPABASE_KEY", ""), "<redacted>")
        print(f"{name}: unavailable; {text[:300]}")

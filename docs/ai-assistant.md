# MailMate AI Assistant suite

The Assistant section is an on-device feature surface using the current inbox snapshot. It does not send email contents to an API or a hosted model.

## Features
- Daily briefing: reuses existing priority and briefing signals to present unread, high-priority, deadlines, and action counts.
- Ask your inbox: TF-IDF retrieval returns relevant messages and matching sentence excerpts. It is intentionally extractive; it does not claim a hosted LLM generated an answer.
- Action items: surfaces actions already extracted by MailMate with detected due dates.
- Security scan: deterministic warning-pattern screening for credential requests, payment pressure, prize/urgency language, secrecy requests, short links, and link/attachment prompts.

## Limitations
Risk screening is heuristic and cannot establish that a message is safe or malicious. Sender/domain reputation, URL destination inspection, attachment sandboxing, and a trained phishing model are not included. Retrieval relevance is a lexical TF-IDF score, not calibrated answer confidence. Always verify the source email.

All feature processing uses the local browser inbox snapshot. No email body or subject is sent to the backend by this module.

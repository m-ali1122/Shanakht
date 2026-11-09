"""Identifier patterns shared by the pseudonymizer and the outbound check."""
import re

IBAN = re.compile(r"\bPK\d{2}[A-Z0-9]{4}\d{16}\b", re.I)
CNIC = re.compile(r"\b\d{5}-\d{7}-\d\b|\b\d{13}\b")
PHONE = re.compile(r"(?<!\d)(?:\+92[-\s]?|0092[-\s]?|0)3\d{2}[-\s]?\d{7}(?!\d)")
DEVICE = re.compile(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b", re.I)
FP = re.compile(r"\b(?:0x)?[0-9a-f]{64}\b", re.I)
URDU_WORD = re.compile(r"[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿‌]+")
TOKEN = re.compile(r"(?<![\w$])(PERSON|ACCT|CNIC|PHONE|DEV|FP)_(\d+)\b")

# (kind, pattern) in the order they are applied. FP before CNIC so 64-hex runs
# are not eaten as digit runs; DEVICE before PHONE.
STRUCTURED = [("fp", FP), ("device", DEVICE), ("acct", IBAN), ("cnic", CNIC), ("phone", PHONE)]

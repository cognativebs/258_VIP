import os
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

# The suite must run "without live keys" on any machine, including the operator
# workstation where orchestr8/.env holds real keys. Importing
# orchestr8/services/provider_env.py calls load_dotenv() at module import time,
# which injects those real keys into os.environ and makes provider-selection
# tests non-deterministic (they pass in CI, fail on the workstation). Setting
# this before any orchestr8 import keeps the suite hermetic.
os.environ["ORCHESTR8_SKIP_DOTENV"] = "1"

# Clear anything the parent shell already exported, so a test that sets exactly
# one provider key really has exactly one provider configured.
for _key in ("OPENAI_API_KEY", "ANTHROPIC_API_KEY", "XAI_API_KEY", "GROK_API_KEY"):
    os.environ.pop(_key, None)

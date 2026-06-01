"""Shared Jinja2Templates instance with global UI strings."""

from fastapi.templating import Jinja2Templates

from app.config import TEMPLATES_DIR
from app.strings import STRINGS, strings_json

templates = Jinja2Templates(directory=TEMPLATES_DIR)
templates.env.globals["S"] = STRINGS["is"]
templates.env.globals["strings_json"] = strings_json()

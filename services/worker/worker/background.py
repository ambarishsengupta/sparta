"""Background removal behind an interface (LLD 7.3 step 3): tests use a fake, production uses rembg with the small u2netp model."""
from __future__ import annotations

from typing import Protocol

from PIL import Image

MODEL_NAME = "u2netp"


class BackgroundRemover(Protocol):
    def remove(self, image: Image.Image) -> Image.Image:
        """Return an RGBA picture of the same size, transparent where the background was."""


class RembgRemover:
    """One rembg session, created once and kept (the model loads from U2NET_HOME; the image build pre-downloads it)."""

    def __init__(self, model_name: str = MODEL_NAME):
        from rembg import new_session            # imported here so the rest of the worker (and its tests) need no model
        self._session = new_session(model_name)

    def remove(self, image: Image.Image) -> Image.Image:
        from rembg import remove
        out = remove(image.convert("RGB"), session=self._session)
        if not isinstance(out, Image.Image):
            raise TypeError("rembg returned no image")
        return out.convert("RGBA")

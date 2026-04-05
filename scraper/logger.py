"""Centralized logging configuration for the scraper."""

from __future__ import annotations

import logging
import sys

from config import DATA_DIR

LOG_FILE = DATA_DIR / "scraper.log"


def setup_logging(level: int = logging.INFO) -> logging.Logger:
    """Configure logging to both stdout and file."""
    logger = logging.getLogger("scraper")
    if logger.handlers:
        return logger  # already configured

    logger.setLevel(level)
    formatter = logging.Formatter(
        fmt="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    # Console handler
    console = logging.StreamHandler(sys.stdout)
    console.setLevel(level)
    console.setFormatter(formatter)
    logger.addHandler(console)

    # File handler
    try:
        LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
        file_handler = logging.FileHandler(LOG_FILE, mode="a", encoding="utf-8")
        file_handler.setLevel(logging.DEBUG)  # capture everything to file
        file_handler.setFormatter(formatter)
        logger.addHandler(file_handler)
    except OSError:
        logger.warning("Could not create log file at %s", LOG_FILE)

    return logger


def get_logger(name: str) -> logging.Logger:
    """Get a child logger under the scraper namespace."""
    parent = setup_logging()
    return parent.getChild(name)

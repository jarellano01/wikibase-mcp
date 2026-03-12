"""run_analysis tool — execute Python code in a sandboxed subprocess."""

import asyncio
import base64
import os
import tempfile
import textwrap
from typing import Any

PREAMBLE = textwrap.dedent("""\
    import os, json
    try:
        import pandas as pd
        import numpy as np
        import matplotlib
        matplotlib.use('Agg')
        import matplotlib.pyplot as plt
        from sqlalchemy import create_engine, text
        target_engine = create_engine(os.environ['_TARGET_URL'])
        reporting_engine = create_engine(os.environ['_REPORTING_URL'])
    except Exception:
        pass
""")


async def _run_analysis_impl(code: str, target_url: str, reporting_url: str, timeout: int = 60) -> dict[str, Any]:
    with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False) as f:
        f.write(PREAMBLE + "\n" + code)
        script_path = f.name
    env = os.environ.copy()
    env["_TARGET_URL"] = target_url
    env["_REPORTING_URL"] = reporting_url
    try:
        proc = await asyncio.create_subprocess_exec(
            "python", script_path,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )
        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.communicate()
            return {"stdout": "", "stderr": "", "images": [], "error": f"Timed out after {timeout}s"}
        images = []
        for i in range(20):
            p = f"/tmp/mcp_plot_{i}.png"
            if os.path.exists(p):
                with open(p, "rb") as img:
                    images.append(base64.b64encode(img.read()).decode())
                os.remove(p)
        return {
            "stdout": stdout.decode(),
            "stderr": stderr.decode(),
            "images": images,
            "error": stderr.decode() if proc.returncode != 0 else None,
        }
    finally:
        os.unlink(script_path)


def register_analysis_tools(mcp, get_db, get_settings):
    import json

    @mcp.tool()
    async def run_analysis(code: str) -> str:
        """Execute Python with pre-configured DB connections (target_engine, reporting_engine). pandas, numpy, sklearn, matplotlib available. 60s timeout."""
        s = get_settings()
        return json.dumps(await _run_analysis_impl(code, s.target_database_url, s.database_url))

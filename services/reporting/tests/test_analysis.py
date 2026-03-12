import pytest
from reporting_mcp.tools.analysis import _run_analysis_impl


@pytest.mark.asyncio
async def test_simple_code():
    result = await _run_analysis_impl("print(2+2)", "postgresql://fake", "postgresql://fake")
    assert "4" in result["stdout"]


@pytest.mark.asyncio
async def test_timeout():
    result = await _run_analysis_impl(
        "import time; time.sleep(120)", "postgresql://fake", "postgresql://fake", timeout=2
    )
    assert result["error"] is not None

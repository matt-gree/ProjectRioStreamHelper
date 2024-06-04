from fastapi import APIRouter

router_v1 = APIRouter(
    prefix="/api/v1",
    tags=["api","api_v1"]
)
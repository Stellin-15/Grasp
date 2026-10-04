import os

import uvicorn
from fastapi import FastAPI

from shop import BillingService
from shop.models import Order

app = FastAPI(title="shop")


@app.post("/orders/{order_id}/charge")
async def charge_order(order_id: int, total_cents: int) -> dict:
    service = BillingService(provider=None)
    ok = await service.charge(Order(id=order_id, total_cents=total_cents))
    return {"charged": ok}


def run() -> None:
    uvicorn.run(app, port=int(os.environ.get("PORT", "8000")))


if __name__ == "__main__":
    run()

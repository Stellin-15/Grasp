"""Billing: turns orders into invoices and charges them."""

from __future__ import annotations

import logging
from decimal import Decimal

from ..models import Invoice, Order

log = logging.getLogger(__name__)


class BillingService:
    """Creates invoices and talks to the payment provider."""

    def __init__(self, provider, *, retries: int = 3):
        self.provider = provider
        self.retries = retries

    def invoice_for(self, order: Order) -> Invoice:
        """Builds an invoice. Amounts are converted from cents.

        Raises:
            ValueError: if the order total is negative.
        """
        if order.total_cents < 0:
            raise ValueError("negative total")
        return Invoice(order_id=order.id, amount=Decimal(order.total_cents) / 100)

    async def charge(self, order: Order) -> bool:
        invoice = self.invoice_for(order)
        for attempt in range(self.retries):
            if await self.provider.pay(invoice):
                return True
            log.warning("payment attempt %s failed", attempt)
        return False

    @staticmethod
    def _fee(amount: Decimal) -> Decimal:
        return amount * Decimal("0.029")


def charge(service: BillingService, order: Order) -> bool:
    """Synchronous helper for scripts."""
    import asyncio

    return asyncio.run(service.charge(order))

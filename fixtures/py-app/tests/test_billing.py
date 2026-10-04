import pytest

from shop.models import Order
from shop.services.billing import BillingService


def test_invoice_converts_cents():
    service = BillingService(provider=None)
    invoice = service.invoice_for(Order(id=1, total_cents=250))
    assert str(invoice.amount) == "2.5"


def test_negative_total_rejected():
    with pytest.raises(ValueError):
        BillingService(provider=None).invoice_for(Order(id=1, total_cents=-1))

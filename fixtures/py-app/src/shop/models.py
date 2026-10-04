from dataclasses import dataclass, field
from decimal import Decimal

from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

DEFAULT_CURRENCY = "USD"


class Base(DeclarativeBase):
    pass


class Order(Base):
    """A customer order persisted in the `orders` table."""

    __tablename__ = "orders"

    id: Mapped[int] = mapped_column(primary_key=True)
    total_cents: Mapped[int]


@dataclass
class Invoice:
    order_id: int
    amount: Decimal
    currency: str = DEFAULT_CURRENCY
    lines: list[str] = field(default_factory=list)

    @property
    def is_free(self) -> bool:
        return self.amount == 0

import { useState } from "react";

export interface ButtonProps {
  label: string;
  onClick?: () => void;
}

export default function Button({ label, onClick }: ButtonProps) {
  const [count, setCount] = useState(0);
  return (
    <button
      onClick={() => {
        setCount(count + 1);
        onClick?.();
      }}
    >
      {label} ({count})
    </button>
  );
}

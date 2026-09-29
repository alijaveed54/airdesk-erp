"use client";

import { useEffect, useState } from "react";

export default function DashboardContentWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  useEffect(() => {
    // Initial check from localStorage
    const saved = localStorage.getItem("sidebar_collapsed");
    if (saved !== null) {
      setIsCollapsed(saved === "true");
    }

    // Listen to real-time toggle events from Sidebar
    function handleToggle(e: any) {
      setIsCollapsed(Boolean(e.detail?.collapsed));
    }

    window.addEventListener("sidebar_toggle", handleToggle);
    return () => {
      window.removeEventListener("sidebar_toggle", handleToggle);
    };
  }, []);

  return (
    <div
      className={`min-h-screen transition-all duration-300 ease-in-out ${
        isCollapsed ? "lg:pl-20" : "lg:pl-72"
      }`}
    >
      {children}
    </div>
  );
}
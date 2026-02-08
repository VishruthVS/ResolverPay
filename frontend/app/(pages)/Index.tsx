"use client";

import { redirect } from "next/navigation";
import { useEffect } from "react";

const Index = () => {
  useEffect(() => {
    redirect("/ens");
  }, []);

  return null;
};

export default Index;

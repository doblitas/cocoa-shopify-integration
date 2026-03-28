import { DashboardClient } from "@/components/dashboard/DashboardClient";
import type { GetServerSideProps } from "next";

export default function DashboardPage() {
  return <DashboardClient />;
}

export const getServerSideProps: GetServerSideProps = async ({ res }) => {
  res.setHeader("Cache-Control", "private, no-store, must-revalidate");
  return { props: {} };
};

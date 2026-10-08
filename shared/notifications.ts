export type DeliveryState = "pending" | "sent" | "failed" | "uncertain";
export type EmailStatus = {
  enabled: boolean; configured: boolean; recipient: string; timeZone: string;
  reminderHour: number; reminderMinute: number; testAvailableAt: number;
  recent: Array<{ kind: "test" | "reminder"; name: string; status: DeliveryState; updatedAt: number; error: string | null }>;
};

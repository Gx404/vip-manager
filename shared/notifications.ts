export type DeliveryState = "pending" | "sent" | "failed" | "uncertain";
export type EmailStatus = {
  enabled: boolean; configured: boolean; recipient: string; timeZone: string;
  reminderHour: number; reminderMinute: number; testAvailableAt: number;
  recent: Array<{ kind: "test" | "reminder"; name: string; status: DeliveryState; updatedAt: number; error: string | null }>;
};

/** Editable server email settings. Passwords are accepted on save and never returned. */
export type EmailSettingsValue = {
  enabled: boolean; host: string; port: number; username: string; from: string; to: string;
  reminderHour: number; reminderMinute: number;
};
export type EmailSettingsView = EmailSettingsValue & {
  passwordConfigured: boolean; timeZone: string; revision: string; editable: boolean;
  lockedFields: Array<keyof EmailSettingsValue | "password">;
};

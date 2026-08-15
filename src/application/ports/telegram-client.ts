import type { NotificationTarget } from "../../domain/notification.ts";

export type SendTextInput = {
  target: NotificationTarget;
  text: string;
};

export type SendPhotoInput = {
  target: NotificationTarget;
  imageUrl: string;
  caption?: string | undefined;
};

export interface TelegramClient {
  sendText(input: SendTextInput): Promise<void>;
  sendPhoto(input: SendPhotoInput): Promise<void>;
}

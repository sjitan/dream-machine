import { 
  dreamItems, userSettings,
  type DreamItem, type InsertDreamItem,
  type UserSettings, type InsertUserSettings
} from "@shared/schema";
import { db } from "./db";
import { eq } from "drizzle-orm";

export interface IStorage {
  getDreamItems(): Promise<DreamItem[]>;
  createDreamItem(item: InsertDreamItem): Promise<DreamItem>;
  updateDreamItem(id: number, updates: Partial<InsertDreamItem>): Promise<DreamItem | undefined>;
  deleteDreamItem(id: number): Promise<boolean>;
  
  getSettings(): Promise<UserSettings | undefined>;
  updateSettings(updates: Partial<InsertUserSettings>): Promise<UserSettings>;
}

export class DatabaseStorage implements IStorage {
  async getDreamItems(): Promise<DreamItem[]> {
    return db.select().from(dreamItems).orderBy(dreamItems.id);
  }

  async createDreamItem(item: InsertDreamItem): Promise<DreamItem> {
    const [newItem] = await db.insert(dreamItems).values(item).returning();
    return newItem;
  }

  async updateDreamItem(id: number, updates: Partial<InsertDreamItem>): Promise<DreamItem | undefined> {
    const [updated] = await db
      .update(dreamItems)
      .set(updates)
      .where(eq(dreamItems.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteDreamItem(id: number): Promise<boolean> {
    const result = await db.delete(dreamItems).where(eq(dreamItems.id, id)).returning();
    return result.length > 0;
  }

  async getSettings(): Promise<UserSettings | undefined> {
    const [settings] = await db.select().from(userSettings).limit(1);
    return settings || undefined;
  }

  async updateSettings(updates: Partial<InsertUserSettings>): Promise<UserSettings> {
    const existing = await this.getSettings();
    if (existing) {
      const [updated] = await db
        .update(userSettings)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(userSettings.id, existing.id))
        .returning();
      return updated;
    } else {
      const [created] = await db.insert(userSettings).values(updates).returning();
      return created;
    }
  }
}

export const storage = new DatabaseStorage();

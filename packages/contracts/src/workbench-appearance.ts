export interface AgentAppearance {
  name: string;
  description: string;
  avatarKey: string;
  avatarColor: string;
}

export interface WorkbenchAppearance {
  brand: { name: string; subtitle: string; logo: string };
  qa: AgentAppearance;
  addAgentLabel: string;
}

export type AppearanceSection = keyof WorkbenchAppearance;

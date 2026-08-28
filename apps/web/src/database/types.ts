import type {
  ManagedNode
} from "@webops/shared";

export interface DatabaseVisualizerProps {
  token: string;
  nodes: ManagedNode[];
  selectedDatabaseId?: string | null;
  onClose?: () => void;
  onSelectDatabase?: (id: string | null) => void;
  darkMode?: boolean;
}

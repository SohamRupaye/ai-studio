import {
  BrainIcon,
  FileTextIcon,
  GitBranchIcon,
  GlobeIcon,
  ListChecksIcon,
  NotebookIcon,
  TerminalWindowIcon,
  TreeStructureIcon,
  WrenchIcon,
} from "@phosphor-icons/react";
import { MarkerIcon } from "../ui/marker";

/** What kind of work a tool name represents — drives the row's icon. */
export function toolIcon(name: string): React.ComponentProps<typeof MarkerIcon>["children"] {
  if (/^(web_search|web_fetch|http_)/.test(name)) return <GlobeIcon />;
  if (/^(read_file|write_file|edit_file|apply_patch|list_files|glob|grep)/.test(name)) return <FileTextIcon />;
  if (/^(bash|terminal_)/.test(name)) return <TerminalWindowIcon />;
  if (/^(remember|recall_memories)/.test(name)) return <BrainIcon />;
  if (/^kb_/.test(name)) return <NotebookIcon />;
  if (/^(subagent|delegate)/.test(name)) return <TreeStructureIcon />;
  if (/^(todo_|think)/.test(name)) return <ListChecksIcon />;
  if (/^git/.test(name)) return <GitBranchIcon />;
  return <WrenchIcon />;
}

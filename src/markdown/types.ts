/**
 * Type definitions mirroring Notion's block and rich-text API shapes,
 * plus our internal intermediate representations used by the converter.
 *
 * We don't import from any Notion SDK — these are hand-rolled to match
 * the REST API as documented at https://developers.notion.com/reference.
 * Pinning to API version 2022-06-28 (see http.ts).
 */

// ---------- Rich Text ----------

export interface Annotations {
  bold: boolean;
  italic: boolean;
  strikethrough: boolean;
  underline: boolean;
  code: boolean;
  color: string;  // "default" | "gray" | ... | "red_background" | ...
}

export const DEFAULT_ANNOTATIONS: Annotations = {
  bold: false,
  italic: false,
  strikethrough: false,
  underline: false,
  code: false,
  color: "default",
};

export interface TextRichText {
  type: "text";
  text: { content: string; link: { url: string } | null };
  annotations: Annotations;
  plain_text: string;
  href: string | null;
}

export interface MentionRichText {
  type: "mention";
  mention:
    | { type: "user"; user: { id: string } }
    | { type: "page"; page: { id: string } }
    | { type: "database"; database: { id: string } }
    | { type: "date"; date: { start: string; end: string | null; time_zone: string | null } }
    | { type: "link_preview"; link_preview: { url: string } };
  annotations: Annotations;
  plain_text: string;
  href: string | null;
}

export interface EquationRichText {
  type: "equation";
  equation: { expression: string };
  annotations: Annotations;
  plain_text: string;
  href: string | null;
}

export type RichText = TextRichText | MentionRichText | EquationRichText;

// ---------- Blocks ----------

export type BlockType =
  | "paragraph"
  | "heading_1"
  | "heading_2"
  | "heading_3"
  | "bulleted_list_item"
  | "numbered_list_item"
  | "to_do"
  | "toggle"
  | "quote"
  | "code"
  | "divider"
  | "callout"
  | "table"
  | "table_row"
  | "equation"
  | "bookmark"
  | "link_preview"
  | "image"
  | "video"
  | "file"
  | "pdf"
  | "child_page"
  | "child_database"
  | "embed"
  | "synced_block"
  | "column_list"
  | "column"
  | "table_of_contents"
  | "breadcrumb"
  | "unsupported";

export interface BaseBlock {
  object: "block";
  id: string;
  parent?: { type: string; page_id?: string; database_id?: string; block_id?: string };
  type: BlockType;
  created_time?: string;
  last_edited_time?: string;
  has_children: boolean;
  in_trash?: boolean;
}

export interface ParagraphBlock extends BaseBlock {
  type: "paragraph";
  paragraph: { rich_text: RichText[]; color: string; children?: Block[] };
}

export interface HeadingBlock extends BaseBlock {
  type: "heading_1" | "heading_2" | "heading_3";
  heading_1?: { rich_text: RichText[]; color: string; is_toggleable: boolean; children?: Block[] };
  heading_2?: { rich_text: RichText[]; color: string; is_toggleable: boolean; children?: Block[] };
  heading_3?: { rich_text: RichText[]; color: string; is_toggleable: boolean; children?: Block[] };
}

export interface ListItemBlock extends BaseBlock {
  type: "bulleted_list_item" | "numbered_list_item";
  bulleted_list_item?: { rich_text: RichText[]; color: string; children?: Block[] };
  numbered_list_item?: { rich_text: RichText[]; color: string; children?: Block[] };
}

export interface ToDoBlock extends BaseBlock {
  type: "to_do";
  to_do: { rich_text: RichText[]; checked: boolean; color: string; children?: Block[] };
}

export interface ToggleBlock extends BaseBlock {
  type: "toggle";
  toggle: { rich_text: RichText[]; color: string; children?: Block[] };
}

export interface QuoteBlock extends BaseBlock {
  type: "quote";
  quote: { rich_text: RichText[]; color: string; children?: Block[] };
}

export interface CodeBlock extends BaseBlock {
  type: "code";
  code: { rich_text: RichText[]; caption: RichText[]; language: string };
}

export interface DividerBlock extends BaseBlock {
  type: "divider";
  divider: Record<string, never>;
}

export interface CalloutBlock extends BaseBlock {
  type: "callout";
  callout: {
    rich_text: RichText[];
    icon: { type: "emoji"; emoji: string } | { type: "external"; external: { url: string } } | null;
    color: string;
    children?: Block[];
  };
}

export interface TableBlock extends BaseBlock {
  type: "table";
  table: {
    table_width: number;
    has_column_header: boolean;
    has_row_header: boolean;
    children?: TableRowBlock[];
  };
}

export interface TableRowBlock extends BaseBlock {
  type: "table_row";
  table_row: { cells: RichText[][] };
}

export interface EquationBlock extends BaseBlock {
  type: "equation";
  equation: { expression: string };
}

export interface GenericPassThroughBlock extends BaseBlock {
  type:
    | "bookmark"
    | "link_preview"
    | "image"
    | "video"
    | "file"
    | "pdf"
    | "child_page"
    | "child_database"
    | "embed"
    | "synced_block"
    | "column_list"
    | "column"
    | "table_of_contents"
    | "breadcrumb"
    | "unsupported";
  [key: string]: unknown;
}

export type Block =
  | ParagraphBlock
  | HeadingBlock
  | ListItemBlock
  | ToDoBlock
  | ToggleBlock
  | QuoteBlock
  | CodeBlock
  | DividerBlock
  | CalloutBlock
  | TableBlock
  | TableRowBlock
  | EquationBlock
  | GenericPassThroughBlock;

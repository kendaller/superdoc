// ---------------------------------------------------------------------------
// Lightweight XML utilities for small OPC package-level XML files
//
// Used ONLY for [Content_Types].xml and .rels files during fast-open.
// These files are always small — full eager parsing is acceptable here.
// The large-content XML indexer in src/xml/ is a separate system.
// ---------------------------------------------------------------------------

export type MiniElement = {
  localName: string;
  prefix?: string;
  attributes: Record<string, string>;
  children: MiniElement[];
  text?: string;
};

/**
 * Parse a small XML string into a minimal element tree.
 * NOT suitable for large XML — this is only for OPC metadata files.
 */
export function parseMiniXml(xml: string): MiniElement {
  let pos = 0;

  // Skip BOM
  if (xml.charCodeAt(0) === 0xfeff) pos = 1;

  // Skip XML declaration
  skipWhitespace();
  if (xml.startsWith("<?xml", pos)) {
    pos = xml.indexOf("?>", pos);
    if (pos === -1) throw new Error("Unterminated XML declaration");
    pos += 2;
  }

  skipWhitespace();
  return parseElement();

  function skipWhitespace(): void {
    while (pos < xml.length && " \t\r\n".includes(xml[pos])) pos++;
  }

  function parseElement(): MiniElement {
    if (xml[pos] !== "<") throw new Error(`Expected '<' at position ${pos}`);
    pos++; // skip <

    const tagName = readName();
    const [localName, prefix] = splitQName(tagName);
    const attributes: Record<string, string> = {};

    // Parse attributes
    while (pos < xml.length) {
      skipWhitespace();
      if (xml[pos] === "/" && xml[pos + 1] === ">") {
        pos += 2;
        return { localName, prefix, attributes, children: [] };
      }
      if (xml[pos] === ">") {
        pos++;
        break;
      }
      const attrName = readName();
      skipWhitespace();
      if (xml[pos] !== "=") throw new Error(`Expected '=' at position ${pos}`);
      pos++;
      skipWhitespace();
      const quote = xml[pos];
      if (quote !== '"' && quote !== "'")
        throw new Error(`Expected quote at position ${pos}`);
      pos++;
      const valueEnd = xml.indexOf(quote, pos);
      if (valueEnd === -1) throw new Error(`Unterminated attribute value`);
      attributes[attrName] = decodeXmlEntities(xml.slice(pos, valueEnd));
      pos = valueEnd + 1;
    }

    // Parse children and text
    const children: MiniElement[] = [];
    let text = "";

    while (pos < xml.length) {
      if (xml[pos] === "<") {
        if (xml[pos + 1] === "/") {
          // Closing tag
          pos += 2;
          readName(); // skip the tag name
          skipWhitespace();
          if (xml[pos] === ">") pos++;
          return {
            localName,
            prefix,
            attributes,
            children,
            text: text || undefined,
          };
        }
        if (xml.startsWith("<!--", pos)) {
          // Skip comments
          const end = xml.indexOf("-->", pos);
          pos = end === -1 ? xml.length : end + 3;
          continue;
        }
        if (xml.startsWith("<?", pos)) {
          // Skip processing instructions
          const end = xml.indexOf("?>", pos);
          pos = end === -1 ? xml.length : end + 2;
          continue;
        }
        children.push(parseElement());
      } else {
        text += xml[pos];
        pos++;
      }
    }

    return { localName, prefix, attributes, children, text: text || undefined };
  }

  function readName(): string {
    const start = pos;
    while (
      pos < xml.length &&
      !" \t\r\n=/>".includes(xml[pos])
    ) {
      pos++;
    }
    return xml.slice(start, pos);
  }
}

function splitQName(qname: string): [string, string | undefined] {
  const colon = qname.indexOf(":");
  if (colon === -1) return [qname, undefined];
  return [qname.slice(colon + 1), qname.slice(0, colon)];
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

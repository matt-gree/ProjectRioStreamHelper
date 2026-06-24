import * as React from "react";

/* ------------------------------------------------------------------ *
 * FileButton — Mantine-shaped file picker.
 *
 * Usage: <FileButton onChange={file => …} accept="...">
 *          {(props) => <Button {...props}>Upload</Button>}
 *        </FileButton>
 * Renders a hidden <input type=file>; the render-prop receives an
 * onClick that opens the picker. Resets value after each pick so the
 * same file can be chosen twice in a row.
 * ------------------------------------------------------------------ */
export function FileButton({ onChange, accept, multiple = false, children }) {
  const inputRef = React.useRef(null);

  const handleChange = (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) { onChange?.(multiple ? [] : null); return; }
    onChange?.(multiple ? Array.from(files) : files[0]);
    e.target.value = "";
  };

  return (
    <>
      {children({ onClick: () => inputRef.current?.click() })}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        onChange={handleChange}
        className="hidden"
      />
    </>
  );
}

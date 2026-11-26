import { Table, type TableProps } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";

/**
 * A table whose column titles stay in view (see ARCHITECTURE.md, Front end).
 * On a screen wide enough for it the page scrolls and the titles stick under
 * the application header. On a narrower one the table scrolls both ways in a
 * box of its own, since a box that scrolls sideways cannot stick to the page.
 */
export function DataTable({ minWidth, ...props }: TableProps & { minWidth: number }) {
  const wide = useMediaQuery(`(min-width: ${minWidth + 80}px)`, true, {
    getInitialValueInEffect: false,
  });
  return wide ? (
    <Table stickyHeader stickyHeaderOffset="var(--app-shell-header-height, 0px)" {...props} />
  ) : (
    <Table.ScrollContainer minWidth={minWidth} maxHeight="75vh">
      <Table stickyHeader {...props} />
    </Table.ScrollContainer>
  );
}

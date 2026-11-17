import { Blueprint } from "@/components/ui/blueprint";

/** User management is a later phase; employees (incl. login accounts) are managed on /employees. */
export function AdminPlaceholder() {
  return (
    <Blueprint className="flex max-w-[640px] flex-col gap-[10px] px-7 py-10">
      <span className="tag tag-outline self-start">Not in this design pass</span>
      <h2 className="m-0">Administration screens</h2>
      <p className="m-0">
        Full user administration (role changes, password resets, disabling accounts) arrives in a later phase. Employees and their login accounts are
        managed under Employees; exchange rates under Settings.
      </p>
    </Blueprint>
  );
}

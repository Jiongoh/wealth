import { ChevronDownIcon } from "@/components/NavIcons";

export function UserProfileCard() {
  return (
    <section className="user-profile-card" aria-label="Current workspace">
      <span className="user-avatar" aria-hidden="true">
        J
      </span>
      <span className="user-profile-copy">
        <strong>Jiong</strong>
        <span>Personal Workspace</span>
      </span>
      <ChevronDownIcon className="user-profile-chevron" />
    </section>
  );
}

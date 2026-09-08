import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PlateauStatus } from "@nutrition/shared";
import { PlateauAdviceCallout } from "./PlateauAdviceCallout";

describe("PlateauAdviceCallout", () => {
  it("plateauedの場合、停滞している旨のタイトルとplateau.messageの本文を表示する", () => {
    const plateau: PlateauStatus = {
      status: "plateaued",
      message:
        "目標カロリーを1日あたり50kcal引き下げるか、有酸素運動を週10分追加することで、停滞を打開できる可能性があります。",
    };

    const { getByText } = render(<PlateauAdviceCallout plateau={plateau} />);

    expect(getByText("この2週間、体重の減少が停滞しています")).toBeTruthy();
    expect(
      getByText(
        "目標カロリーを1日あたり50kcal引き下げるか、有酸素運動を週10分追加することで、停滞を打開できる可能性があります。",
      ),
    ).toBeTruthy();
  });

  it("plateauedの場合、2件の異なるplateau.messageがそれぞれそのまま表示される（ハードコードされた固定文言でないことの確認）", () => {
    const first = render(
      <PlateauAdviceCallout plateau={{ status: "plateaued", message: "メッセージA" }} />,
    );
    expect(first.getByText("メッセージA")).toBeTruthy();
    expect(first.queryByText("メッセージB")).toBeNull();
    first.unmount();

    const second = render(
      <PlateauAdviceCallout plateau={{ status: "plateaued", message: "メッセージB" }} />,
    );
    expect(second.getByText("メッセージB")).toBeTruthy();
    expect(second.queryByText("メッセージA")).toBeNull();
  });

  it("on_trackの場合、何も表示しない", () => {
    const { container } = render(<PlateauAdviceCallout plateau={{ status: "on_track" }} />);
    expect(container.firstChild).toBeNull();
  });

  it("insufficient_dataの場合、何も表示しない", () => {
    const { container } = render(
      <PlateauAdviceCallout plateau={{ status: "insufficient_data" }} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("not_applicableの場合、何も表示しない", () => {
    const { container } = render(
      <PlateauAdviceCallout plateau={{ status: "not_applicable" }} />,
    );
    expect(container.firstChild).toBeNull();
  });
});

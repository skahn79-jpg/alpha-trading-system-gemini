import SwiftUI
import Charts

/// 차트 랩 — 집중 차트 분석: 매물대·과거 패턴 전망·자동 해설·섹션 선택 적용
struct ChartLabView: View {
    let stock: Stock
    @State private var lab: ChartLabResponse?
    @State private var isLoading = true
    @State private var errorMessage: String?

    // 섹션 선택 적용 (자동 = 모두 ON)
    @State private var showLevels = true
    @State private var showProfile = true
    @State private var showOutlook = true
    @State private var showCommentary = true

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                ChartView(code: stock.code)

                sectionToggles

                if isLoading {
                    LoadingView(message: "차트 랩 분석 중... (장기 데이터 수집)")
                        .frame(maxWidth: .infinity, minHeight: 160)
                } else if let errorMessage {
                    Text(errorMessage)
                        .font(.paperlogy(14))
                        .foregroundStyle(AppTheme.down)
                        .padding()
                } else if let lab {
                    if showLevels { levelsCard(lab) }
                    if showProfile, let vp = lab.volumeProfile { profileCard(vp, close: lab.close ?? 0) }
                    if showOutlook, let outlook = lab.outlook { outlookCard(outlook) }
                    if showCommentary, let commentary = lab.commentary { commentaryCard(commentary) }
                }
            }
            .padding(16)
        }
        .background(AppTheme.background)
        .navigationTitle("차트 랩 — \(stock.name)")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await load() }
        .task { await load() }
    }

    private func load() async {
        isLoading = lab == nil
        errorMessage = nil
        do {
            lab = try await APIClient.shared.get("/api/chartlab/\(stock.code)") as ChartLabResponse
        } catch {
            errorMessage = "차트 랩 데이터를 불러오지 못했습니다: \(error.localizedDescription)"
        }
        isLoading = false
    }

    private var sectionToggles: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                toggleChip("레벨", isOn: $showLevels)
                toggleChip("매물대", isOn: $showProfile)
                toggleChip("패턴 전망", isOn: $showOutlook)
                toggleChip("자동 해설", isOn: $showCommentary)
            }
        }
    }

    private func toggleChip(_ label: String, isOn: Binding<Bool>) -> some View {
        Button {
            isOn.wrappedValue.toggle()
        } label: {
            Text(label)
                .font(.paperlogy(12, weight: .semibold))
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(isOn.wrappedValue ? AppTheme.accent.opacity(0.25) : Color.black.opacity(0.25))
                .foregroundStyle(isOn.wrappedValue ? AppTheme.accent : AppTheme.textSecondary)
                .clipShape(Capsule())
        }
    }

    // MARK: - 주요 레벨

    private func levelsCard(_ lab: ChartLabResponse) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("주요 가격 레벨")
                .font(.paperlogy(15, weight: .semibold))
                .foregroundStyle(AppTheme.textPrimary)
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                if let r = lab.analysis?.supportResistance?.resistance {
                    levelRow("저항선", r, color: AppTheme.down)
                }
                if let s = lab.analysis?.supportResistance?.support {
                    levelRow("지지선", s, color: AppTheme.up)
                }
                if let poc = lab.volumeProfile?.poc {
                    levelRow("최대 매물대", (poc.priceLow + poc.priceHigh) / 2, color: AppTheme.accent)
                }
                if let fib = lab.analysis?.fibonacci?.nearest {
                    levelRow("피보나치 \(Int(fib.ratio * 100))%", fib.price, color: .yellow)
                }
                if let kijun = lab.analysis?.ichimoku?.kijun {
                    levelRow("일목 기준선", kijun, color: .purple)
                }
                if let ma200 = lab.analysis?.mayer?.ma200 {
                    levelRow("200일선", ma200, color: .orange)
                }
            }
        }
        .padding(16)
        .background(AppTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }

    private func levelRow(_ name: String, _ price: Double, color: Color) -> some View {
        HStack(spacing: 6) {
            RoundedRectangle(cornerRadius: 1.5).fill(color).frame(width: 3, height: 22)
            VStack(alignment: .leading, spacing: 1) {
                Text(name)
                    .font(.paperlogy(10))
                    .foregroundStyle(AppTheme.textSecondary)
                Text(Int(price).formatted(.number.grouping(.automatic)))
                    .font(.paperlogy(14, weight: .bold))
                    .foregroundStyle(AppTheme.textPrimary)
            }
            Spacer()
        }
        .padding(8)
        .background(Color.black.opacity(0.2))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    // MARK: - 매물대

    private func profileCard(_ vp: VolumeProfileData, close: Double) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("매물대 분석 (거래량 프로파일)")
                .font(.paperlogy(15, weight: .semibold))
                .foregroundStyle(AppTheme.textPrimary)
            Text(vp.positionLabel + " · 상방 매물 \(vp.abovePct ?? 0)% / 하방 \(vp.belowPct ?? 0)%")
                .font(.paperlogy(12))
                .foregroundStyle(AppTheme.textSecondary)

            if let bins = vp.bins, !bins.isEmpty {
                Chart {
                    ForEach(bins) { bin in
                        BarMark(
                            x: .value("비중", bin.sharePct),
                            y: .value("가격", String(Int(bin.midPrice)))
                        )
                        .foregroundStyle(
                            bin.midPrice > close ? AppTheme.down.opacity(0.65) : AppTheme.up.opacity(0.65)
                        )
                    }
                }
                .chartYAxis {
                    AxisMarks(preset: .aligned) { value in
                        AxisValueLabel {
                            if let raw = value.as(String.self), let n = Int(raw) {
                                Text(n.formatted(.number.grouping(.automatic)))
                                    .font(.paperlogy(8))
                            }
                        }
                    }
                }
                .frame(height: 260)
                HStack(spacing: 12) {
                    HStack(spacing: 4) {
                        Circle().fill(AppTheme.down.opacity(0.65)).frame(width: 8, height: 8)
                        Text("현재가 위 매물 (저항)").font(.paperlogy(10)).foregroundStyle(AppTheme.textSecondary)
                    }
                    HStack(spacing: 4) {
                        Circle().fill(AppTheme.up.opacity(0.65)).frame(width: 8, height: 8)
                        Text("현재가 아래 매물 (지지)").font(.paperlogy(10)).foregroundStyle(AppTheme.textSecondary)
                    }
                }
            }
        }
        .padding(16)
        .background(AppTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }

    // MARK: - 과거 패턴 전망

    private func outlookCard(_ outlook: OutlookData) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("과거 유사 패턴 전망")
                .font(.paperlogy(15, weight: .semibold))
                .foregroundStyle(AppTheme.textPrimary)
            HStack(spacing: 20) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("이후 \(outlook.horizon ?? 10)일 평균")
                        .font(.paperlogy(11))
                        .foregroundStyle(AppTheme.textSecondary)
                    Text(String(format: "%+.1f%%", outlook.avgReturn ?? 0))
                        .font(.paperlogy(22, weight: .bold))
                        .foregroundStyle((outlook.avgReturn ?? 0) >= 0 ? AppTheme.up : AppTheme.down)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text("상승 확률")
                        .font(.paperlogy(11))
                        .foregroundStyle(AppTheme.textSecondary)
                    Text("\(outlook.upProbability ?? 0)%")
                        .font(.paperlogy(22, weight: .bold))
                        .foregroundStyle(AppTheme.accent)
                }
                Spacer()
            }
            if let samples = outlook.samples {
                HStack(spacing: 6) {
                    ForEach(samples) { s in
                        Text(String(format: "%+.1f%%", s.fwdReturn))
                            .font(.paperlogy(10, weight: .medium))
                            .padding(.horizontal, 7)
                            .padding(.vertical, 3)
                            .background((s.fwdReturn >= 0 ? AppTheme.up : AppTheme.down).opacity(0.15))
                            .foregroundStyle(s.fwdReturn >= 0 ? AppTheme.up : AppTheme.down)
                            .clipShape(Capsule())
                    }
                }
            }
            if let note = outlook.note {
                Text(note)
                    .font(.paperlogy(10))
                    .foregroundStyle(AppTheme.textSecondary.opacity(0.8))
            }
        }
        .padding(16)
        .background(AppTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }

    // MARK: - 자동 해설

    private func commentaryCard(_ paragraphs: [String]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Image(systemName: "text.magnifyingglass")
                    .foregroundStyle(AppTheme.accent)
                Text("전문가 스타일 자동 해설")
                    .font(.paperlogy(15, weight: .semibold))
                    .foregroundStyle(AppTheme.textPrimary)
            }
            ForEach(paragraphs, id: \.self) { paragraph in
                Text(paragraph)
                    .font(.paperlogy(13))
                    .foregroundStyle(paragraph.hasPrefix("본 해설") ? AppTheme.textSecondary.opacity(0.7) : AppTheme.textPrimary)
                    .lineSpacing(4)
            }
        }
        .padding(16)
        .background(AppTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }
}

import SwiftUI

struct PortfolioView: View {
    @StateObject private var viewModel = PortfolioViewModel()
    @State private var showAddSheet = false
    @State private var newCode = ""
    @State private var newName = ""
    @State private var newQty = ""
    @State private var newAvg = ""

    var body: some View {
        NavigationStack {
            List {
                Section {
                    summaryRow("총 매입", value: formatMoney(viewModel.totalCost))
                    summaryRow("평가금액", value: formatMoney(viewModel.totalValue))
                    summaryRow("손익", value: formatMoney(viewModel.totalPnL), color: viewModel.totalPnL >= 0 ? AppTheme.up : AppTheme.down)
                }
                .listRowBackground(AppTheme.card)

                Section("보유 종목") {
                    ForEach(viewModel.holdings) { h in
                        let quote = viewModel.quotes[h.code]
                        let price = Double(quote?.price ?? 0)
                        let value = price * h.quantity
                        let pnl = value - h.costBasis
                        VStack(alignment: .leading, spacing: 6) {
                            Text(h.name).font(.paperlogy(16, weight: .semibold))
                            Text("\(h.code) · \(Int(h.quantity))주 · 평단 \(formatMoney(h.avgPrice))")
                                .font(.paperlogy(12))
                                .foregroundStyle(AppTheme.textSecondary)
                            Text("평가 \(formatMoney(value)) · 손익 \(formatMoney(pnl))")
                                .font(.paperlogy(13))
                                .foregroundStyle(pnl >= 0 ? AppTheme.up : AppTheme.down)
                        }
                        .listRowBackground(AppTheme.background)
                    }
                    .onDelete(perform: viewModel.remove)
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(AppTheme.background)
            .navigationTitle("포트폴리오")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("추가") { showAddSheet = true }
                        .foregroundStyle(AppTheme.accent)
                }
            }
            .refreshable { await viewModel.refreshQuotes() }
            .task { await viewModel.refreshQuotes() }
            .sheet(isPresented: $showAddSheet) {
                addSheet
            }
        }
    }

    private func summaryRow(_ title: String, value: String, color: Color = AppTheme.textPrimary) -> some View {
        HStack {
            Text(title).font(.paperlogy(14)).foregroundStyle(AppTheme.textSecondary)
            Spacer()
            Text(value).font(.paperlogy(16, weight: .semibold)).foregroundStyle(color)
        }
    }

    private var addSheet: some View {
        NavigationStack {
            Form {
                TextField("종목코드", text: $newCode)
                TextField("종목명", text: $newName)
                TextField("수량", text: $newQty).keyboardType(.decimalPad)
                TextField("평단가", text: $newAvg).keyboardType(.decimalPad)
            }
            .navigationTitle("종목 추가")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("취소") { showAddSheet = false }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("저장") {
                        let qty = Double(newQty) ?? 0
                        let avg = Double(newAvg) ?? 0
                        guard !newCode.isEmpty, qty > 0, avg > 0 else { return }
                        viewModel.addHolding(code: newCode, name: newName.isEmpty ? newCode : newName, quantity: qty, avgPrice: avg)
                        newCode = ""; newName = ""; newQty = ""; newAvg = ""
                        showAddSheet = false
                        Task { await viewModel.refreshQuotes() }
                    }
                }
            }
        }
        .presentationDetents([.medium])
    }

    private func formatMoney(_ v: Double) -> String {
        v.formatted(.number.precision(.fractionLength(0)).grouping(.automatic)) + "원"
    }
}

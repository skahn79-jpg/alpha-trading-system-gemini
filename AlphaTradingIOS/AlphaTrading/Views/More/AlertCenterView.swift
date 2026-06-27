import SwiftUI

struct AlertCenterView: View {
    @StateObject private var viewModel = AlertViewModel()
    @State private var showAdd = false
    @State private var newCode = "005930"
    @State private var newName = "삼성전자"
    @State private var newType: AlertType = .priceAbove
    @State private var newTarget = "80000"
    @State private var newMessage = ""

    var body: some View {
        List {
            Section {
                Button("알림 권한 요청") {
                    Task { await viewModel.requestNotificationPermission() }
                }
                Button("서버에서 동기화") {
                    Task { await viewModel.syncFromServer() }
                }
                .disabled(viewModel.isLoading)
            }

            if let error = viewModel.errorMessage {
                Text(error).foregroundStyle(AppTheme.down).font(.paperlogy(13))
            }

            Section("등록된 알림") {
                if viewModel.alerts.isEmpty {
                    Text("등록된 알림이 없습니다.")
                        .foregroundStyle(AppTheme.textSecondary)
                } else {
                    ForEach(viewModel.alerts) { alert in
                        VStack(alignment: .leading, spacing: 6) {
                            Text("\(alert.name) (\(alert.code))")
                                .font(.paperlogy(15, weight: .semibold))
                            Text("\(alert.type.label) · \(alert.target > 0 ? "\(Int(alert.target))원" : "20일선")")
                                .font(.paperlogy(13))
                                .foregroundStyle(AppTheme.accent)
                            if !alert.message.isEmpty {
                                Text(alert.message).font(.paperlogy(12)).foregroundStyle(AppTheme.textSecondary)
                            }
                        }
                        .swipeActions {
                            Button(role: .destructive) {
                                Task { await viewModel.removeAlert(alert) }
                            } label: {
                                Label("삭제", systemImage: "trash")
                            }
                        }
                    }
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(AppTheme.background)
        .navigationTitle("알림 센터")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { showAdd = true } label: {
                    Image(systemName: "plus")
                }
            }
        }
        .sheet(isPresented: $showAdd) {
            NavigationStack {
                Form {
                    TextField("종목코드", text: $newCode)
                        .keyboardType(.numberPad)
                    TextField("종목명", text: $newName)
                    Picker("조건", selection: $newType) {
                        ForEach(AlertType.allCases) { t in
                            Text(t.label).tag(t)
                        }
                    }
                    if newType != .ma20Touch {
                        TextField("목표가", text: $newTarget)
                            .keyboardType(.numberPad)
                    }
                    TextField("메모", text: $newMessage)
                }
                .navigationTitle("알림 추가")
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("취소") { showAdd = false }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("저장") {
                            Task {
                                await viewModel.addAlert(
                                    code: newCode,
                                    name: newName,
                                    type: newType,
                                    target: Double(newTarget) ?? 0,
                                    message: newMessage
                                )
                                showAdd = false
                            }
                        }
                    }
                }
            }
            .presentationDetents([.medium])
        }
        .task {
            await viewModel.requestNotificationPermission()
            await viewModel.syncFromServer()
        }
    }
}

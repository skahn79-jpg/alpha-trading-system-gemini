import SwiftUI

struct AdminLoginView: View {
    @EnvironmentObject var auth: AdminAuthViewModel
    @State private var isPasswordVisible = false

    var body: some View {
        ZStack {
            AppTheme.background.ignoresSafeArea()
            ScrollView {
                VStack(spacing: 28) {
                    VStack(spacing: 8) {
                        Text("ALPHA")
                            .font(.paperlogy(32, weight: .bold))
                            .foregroundStyle(AppTheme.accent)
                        Text("관리자 로그인")
                            .font(.paperlogy(16, weight: .medium))
                            .foregroundStyle(AppTheme.textSecondary)
                    }
                    .padding(.top, 48)

                    VStack(spacing: 14) {
                        TextField("아이디", text: $auth.loginId)
                            .textContentType(.username)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .font(.paperlogy(16))
                            .foregroundStyle(AppTheme.textPrimary)
                            .padding(14)
                            .background(AppTheme.card)
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                            .accessibilityLabel("아이디")
                            .submitLabel(.next)
                            .disabled(auth.isLoginFormLocked)

                        HStack(spacing: 8) {
                            Group {
                                if isPasswordVisible {
                                    TextField("비밀번호", text: $auth.password)
                                        .disabled(auth.isLoginFormLocked)
                                } else {
                                    SecureField("비밀번호", text: $auth.password)
                                        .disabled(auth.isLoginFormLocked)
                                }
                            }
                            .textContentType(.password)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .font(.paperlogy(16))
                            .foregroundStyle(AppTheme.textPrimary)
                            .accessibilityLabel("비밀번호")
                            .submitLabel(.go)

                            Button {
                                isPasswordVisible.toggle()
                            } label: {
                                Text(isPasswordVisible ? "숨김" : "표시")
                                    .font(.paperlogy(13, weight: .medium))
                                    .foregroundStyle(AppTheme.accent)
                            }
                            .accessibilityLabel(isPasswordVisible ? "비밀번호 숨김" : "비밀번호 표시")
                            .disabled(auth.isLoginFormLocked)
                        }
                        .padding(14)
                        .background(AppTheme.card)
                        .clipShape(RoundedRectangle(cornerRadius: 12))

                        if let loginError = auth.loginError, !loginError.isEmpty {
                            Text(loginError)
                                .font(.paperlogy(13))
                                .foregroundStyle(AppTheme.down)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .accessibilityLabel("로그인 오류")
                        }

                        if let notice = auth.logoutNotice, !notice.isEmpty {
                            Text(notice)
                                .font(.paperlogy(13))
                                .foregroundStyle(AppTheme.accent)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .accessibilityLabel("로그아웃 안내")
                        }

                        Button {
                            Task { await auth.login() }
                        } label: {
                            HStack(spacing: 8) {
                                if auth.isSubmitting {
                                    ProgressView()
                                        .tint(AppTheme.background)
                                }
                                Text("로그인")
                                    .font(.paperlogy(16, weight: .semibold))
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 14)
                            .background(AppTheme.accent)
                            .foregroundStyle(AppTheme.background)
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                        }
                        .disabled(auth.isLoginFormLocked)
                        .accessibilityLabel("로그인")
                    }
                    .padding(.horizontal, 24)
                }
                .padding(.bottom, 32)
            }
            .onSubmit {
                guard !auth.isLoginFormLocked else { return }
                Task { await auth.login() }
            }
        }
    }
}

struct AdminSessionCheckingView: View {
    var body: some View {
        ZStack {
            AppTheme.background.ignoresSafeArea()
            VStack(spacing: 14) {
                ProgressView()
                    .tint(AppTheme.accent)
                Text("세션을 확인하는 중입니다.")
                    .font(.paperlogy(15))
                    .foregroundStyle(AppTheme.textSecondary)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("세션을 확인하는 중입니다.")
    }
}

struct AdminSessionUnavailableView: View {
    @EnvironmentObject var auth: AdminAuthViewModel

    var body: some View {
        ZStack {
            AppTheme.background.ignoresSafeArea()
            VStack(spacing: 20) {
                Image(systemName: "wifi.slash")
                    .font(.system(size: 36))
                    .foregroundStyle(AppTheme.accent)
                Text("세션을 확인할 수 없습니다.")
                    .font(.paperlogy(18, weight: .semibold))
                    .foregroundStyle(AppTheme.textPrimary)
                Text("네트워크 상태를 확인한 뒤 다시 시도하세요.")
                    .font(.paperlogy(14))
                    .foregroundStyle(AppTheme.textSecondary)
                    .multilineTextAlignment(.center)
                Button {
                    Task { await auth.refreshSession(reason: .manual) }
                } label: {
                    Text("다시 시도")
                        .font(.paperlogy(16, weight: .semibold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(AppTheme.accent)
                        .foregroundStyle(AppTheme.background)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                }
                .disabled(auth.isSubmitting)
                .accessibilityLabel("다시 시도")
            }
            .padding(.horizontal, 32)
        }
    }
}

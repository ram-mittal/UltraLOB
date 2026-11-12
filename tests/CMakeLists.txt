cmake_minimum_required(VERSION 3.28)

# ─────────────────────────────────────────────────────────────────────────────
# Test targets — each links ultralob + GTest, re-enables exceptions for GTest
# ─────────────────────────────────────────────────────────────────────────────

function(add_ultralob_test name src)
  add_executable(${name} ${src})
  target_link_libraries(${name} PRIVATE ultralob GTest::gtest_main)
  if(NOT MSVC)
    target_compile_options(${name} PRIVATE -fexceptions)
  endif()
  add_test(NAME ${name} COMMAND ${name})
endfunction()

add_ultralob_test(test_order_book    test_order_book.cpp)
add_ultralob_test(test_matching      test_matching.cpp)
add_ultralob_test(test_order_types   test_order_types.cpp)
add_ultralob_test(test_statistics    test_statistics.cpp)
add_ultralob_test(test_exchange_node test_exchange_node.cpp)
add_ultralob_test(test_gateway       test_gateway.cpp)
add_ultralob_test(test_journal       test_journal.cpp)
add_ultralob_test(test_risk_engine   test_risk_engine.cpp)
if(WIN32)
  target_link_libraries(test_gateway PRIVATE ws2_32 mswsock)
endif()

# ─────────────────────────────────────────────────────────────────────────────
# FIX Engine Tests
# ─────────────────────────────────────────────────────────────────────────────
add_ultralob_test(test_fix_message     test_fix_message.cpp)
add_ultralob_test(test_fix_builder     test_fix_builder.cpp)
add_ultralob_test(test_fix_framer      test_fix_framer.cpp)
add_ultralob_test(test_fix_integration test_fix_integration.cpp)
add_ultralob_test(test_fix_session     test_fix_session.cpp)
add_ultralob_test(test_fix_store       test_fix_store.cpp)
add_ultralob_test(test_fix_application test_fix_application.cpp)
if(WIN32)
  target_link_libraries(test_fix_integration PRIVATE ws2_32 mswsock)
endif()
